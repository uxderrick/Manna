"""Cross-version evaluation of the no-AI baseline.

Key DB  = every file in songs/va (references + trap songs).
Queries = windows cut from every file in songs/vb (other renditions of the
          same songs, never in the DB).

For each query window we score every song by Shazam-style voting: each query
hash that hits a DB hash votes for (rendition, time-offset bucket); a song's
score is its best rendition's best offset cluster. Votes are IDF-weighted so
common patterns (repeated notes, I-V-vi-IV) count less.

Usage: python evaluate.py [window_seconds ...]   (default 10 15 20 30)
"""
import math
import os
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

from common import FEAT_DIR, audio_rows, split_of, wav_path
from align import AlignIndex
from cqt_align import CqtAlignIndex
from melody_align import MelodyAlignIndex, melody_chroma
from keys import CHROMA_FRAME_S, F0_FRAME_S, HarmonyParams, MelodyParams, harmony_keys, melody_keys

OFFSET_BIN_S = 2.0
QUERY_STEP_S = 20.0
MAX_QUERIES_PER_FILE = 12


MELODY_SRC = os.environ.get("MELODY_SRC", "mix")  # "mix" or "voice" (bass filtered)


def load_feats(row):
    stem = wav_path(row).stem
    f = dict(np.load(FEAT_DIR / (stem + ".npz")))
    if MELODY_SRC != "mix":
        v = np.load(FEAT_DIR.parent / f"features_{MELODY_SRC}" / (stem + ".npz"))
        f["f0"], f["vprob"] = v["f0"], v["vprob"]
    f["cqt"] = np.load(FEAT_DIR.parent / "features_cqt" / (stem + ".npz"))["cqt"]
    ch = FEAT_DIR.parent / "features_chcqt" / (stem + ".npy")
    if ch.exists():
        f["chcqt"] = np.load(ch)
    if "clews" in os.environ.get("LAYERS", ""):
        import soundfile as sf

        f["wav"] = sf.read(wav_path(row), dtype="float32")[0]
    return f


class Index:
    def __init__(self):
        self.post = defaultdict(list)  # hash -> [(rid, t)]
        self.rid_song = []
        self.rid_name = []

    def add(self, song, name, hashes, times):
        rid = len(self.rid_song)
        self.rid_song.append(song)
        self.rid_name.append(name)
        for h, t in zip(hashes.tolist(), times.tolist()):
            self.post[h].append((rid, t))

    def finalize(self):
        n = len(self.rid_song)
        self.idf = {
            h: math.log(1 + n / len({rid for rid, _ in p})) for h, p in self.post.items()
        }

    def score(self, hashes, times):
        """Return {song: score}."""
        buckets = defaultdict(float)
        for h, tq in zip(hashes.tolist(), times.tolist()):
            p = self.post.get(h)
            if not p:
                continue
            w = self.idf[h]
            for rid, tdb in p:
                b = int(math.floor((tdb - tq) / OFFSET_BIN_S))
                buckets[(rid, b)] += w
        best = defaultdict(float)
        for (rid, b), v in buckets.items():
            # tempo differs across renditions: let neighbouring offset bins pool
            s = v + 0.5 * (buckets.get((rid, b - 1), 0) + buckets.get((rid, b + 1), 0))
            song = self.rid_song[rid]
            if s > best[song]:
                best[song] = s
        return best


def slice_feats(f, t0, t1):
    a, b = int(t0 / F0_FRAME_S), int(t1 / F0_FRAME_S)
    c, d = int(t0 / CHROMA_FRAME_S), int(t1 / CHROMA_FRAME_S)
    return {"f0": f["f0"][a:b], "vprob": f["vprob"][a:b],
            "chroma": f["chroma"][:, c:d], "cqt": f["cqt"][:, c:d],
            "chcqt": f["chcqt"][int(t0 / 0.04):int(t1 / 0.04)] if "chcqt" in f else None,
            "wav": f["wav"][int(t0 * 16000):int(t1 * 16000)] if "wav" in f else None}


def rank_of(scores, truth):
    ordered = sorted(scores.items(), key=lambda kv: -kv[1])
    for i, (song, _) in enumerate(ordered):
        if song == truth:
            return i + 1
    return 999


def zscore(s, songs):
    v = np.array([s.get(k, 0.0) for k in songs])
    sd = v.std()
    return dict(zip(songs, (v - v.mean()) / sd)) if sd > 0 else dict.fromkeys(songs, 0.0)


def fuse(layers, weights, songs):
    out = dict.fromkeys(songs, 0.0)
    for s, w in zip(layers, weights):
        if w:
            for k, v in zscore(s, songs).items():
                out[k] += w * v
    return out


class Layer:
    """One matching method: how to index a full reference and score a query slice."""

    def __init__(self, index, add, query, finalize=None):
        self.index, self._add, self._query, self._fin = index, add, query, finalize
        self.stats = None  # song -> (mean, std) of scores against other songs

    def calibrate(self, db, win):
        """Cohort normalisation: score windows of every *other* reference song to
        learn each song's typical impostor score, so long references that fit
        anything stop winning by default."""
        self.stats = None
        imp = defaultdict(list)
        for song, f in db:
            dur = len(f["f0"]) * F0_FRAME_S
            for t0 in np.arange(0, max(dur - win, 0) + 1e-6, CALIB_STEP_S)[:CALIB_WINDOWS]:
                for k, v in self.score(slice_feats(f, t0, t0 + win)).items():
                    if k != song:
                        imp[k].append(v)
        self.stats = {k: (np.mean(v), np.std(v) + 1e-6) for k, v in imp.items() if len(v) > 3}

    def add(self, song, name, f):
        self._add(self.index, song, name, f)

    def finalize(self):
        if self._fin:
            self._fin(self.index)

    def score(self, q):
        raw = self._query(self.index, q)
        if not self.stats:
            return raw
        return {k: (v - self.stats[k][0]) / self.stats[k][1] for k, v in raw.items() if k in self.stats}


def make_layers(enabled=()):
    mp, hp = MelodyParams(), HarmonyParams()
    mp_loose = MelodyParams(n=4, use_durations=False)
    fin = lambda ix: ix.finalize()  # noqa: E731
    layers = {}
    if "coverhunter" in enabled:  # research-only benchmark; needs .venv-ch (torch)
        from coverhunter import CoverHunterIndex

        layers["coverhunter"] = Layer(CoverHunterIndex(), lambda ix, s, n, f: ix.add(s, f["chcqt"]),
                                      lambda ix, q: ix.score(q["chcqt"]))
    if "clews" in enabled:  # MIT code + weights; needs .venv-ch (torch, nnAudio)
        from clews_layer import ClewsIndex

        layers["clews"] = Layer(ClewsIndex(), lambda ix, s, n, f: ix.add(s, n, f["wav"]),
                                lambda ix, q: ix.score(q["wav"]))
    return layers | {
        "melody": Layer(Index(), lambda ix, s, n, f: ix.add(s, n, *melody_keys(f["f0"], f["vprob"], mp)),
                        lambda ix, q: ix.score(*melody_keys(q["f0"], q["vprob"], mp)), fin),
        "melody-loose": Layer(Index(), lambda ix, s, n, f: ix.add(s, n, *melody_keys(f["f0"], f["vprob"], mp_loose)),
                              lambda ix, q: ix.score(*melody_keys(q["f0"], q["vprob"], mp_loose)), fin),
        "harmony": Layer(Index(), lambda ix, s, n, f: ix.add(s, n, *harmony_keys(f["chroma"], hp)),
                         lambda ix, q: ix.score(*harmony_keys(q["chroma"], hp)), fin),
        "chroma-align": Layer(AlignIndex(), lambda ix, s, n, f: ix.add(s, f["chroma"]),
                              lambda ix, q: ix.score(q["chroma"])),
        "melody-align": Layer(MelodyAlignIndex(), lambda ix, s, n, f: ix.add(s, melody_chroma(f["f0"], f["vprob"])),
                              lambda ix, q: ix.score(melody_chroma(q["f0"], q["vprob"]))),
        "cqt-align": Layer(CqtAlignIndex(whiten=True), lambda ix, s, n, f: ix.add(s, f["cqt"]),
                           lambda ix, q: ix.score(q["cqt"])),
        "cqt-raw": Layer(CqtAlignIndex(whiten=False), lambda ix, s, n, f: ix.add(s, f["cqt"]),
                         lambda ix, q: ix.score(q["cqt"])),
    }


# Fusions to report when all their layers are enabled: name -> [(layer, weight)]
FUSIONS = {
    "harm+chroma": [("harmony", 1), ("chroma-align", 1)],
    "chroma+cqt": [("chroma-align", 1), ("cqt-align", 1)],
    "chroma+cqt+harm": [("chroma-align", 1), ("cqt-align", 1), ("harmony", 0.5)],
    "ch+chroma+cqt": [("coverhunter", 1), ("chroma-align", 0.5), ("cqt-align", 0.5)],
    "clews+chroma+cqt": [("clews", 1), ("chroma-align", 0.5), ("cqt-align", 0.5)],
    "clews+coverhunter": [("clews", 1), ("coverhunter", 1)],
}


CALIB_STEP_S = 30.0
CALIB_WINDOWS = 8
COHORT = os.environ.get("COHORT", "1") == "1"
PLAN_SIZE = int(os.environ.get("PLAN_SIZE", "0"))  # simulate a service plan of N songs


def main():
    rng = np.random.default_rng(0)
    windows = [float(x) for x in sys.argv[1:]] or [10, 15, 20, 30]
    enabled = os.environ.get("LAYERS", "harmony,chroma-align,cqt-align,cqt-raw").split(",")
    layers = {k: v for k, v in make_layers(enabled).items() if k in enabled}
    fusions = {k: v for k, v in FUSIONS.items() if all(l in layers for l, _ in v)}
    rows = audio_rows()
    db_rows = [r for r in rows if split_of(r) == "va"]
    q_rows = [r for r in rows if split_of(r) == "vb"]

    db_feats = []
    for r in db_rows:
        f = load_feats(r)
        db_feats.append((r["song_slug"], f))
        for layer in layers.values():
            layer.add(r["song_slug"], Path(r["path"]).stem, f)
    for layer in layers.values():
        layer.finalize()
    db_songs = sorted({r["song_slug"] for r in db_rows})
    print(f"DB: {len(db_rows)} renditions, {len(db_songs)} songs; layers: {', '.join(layers)}")

    report_on = os.environ.get("PER_SONG", next(iter(fusions), next(iter(layers))))
    for win in windows:
        if COHORT:
            for name, layer in layers.items():
                if "align" in name or name in ("coverhunter", "clews"):
                    layer.calibrate(db_feats, win)
        results = defaultdict(list)  # method -> ranks
        per_song = defaultdict(lambda: defaultdict(list))
        for r in q_rows:
            truth = r["song_slug"]
            if truth not in db_songs:
                continue
            f = load_feats(r)
            dur = len(f["f0"]) * F0_FRAME_S
            starts = np.arange(0, max(dur - win, 0) + 1e-6, QUERY_STEP_S)[:MAX_QUERIES_PER_FILE]
            for t0 in starts:
                q = slice_feats(f, t0, t0 + win)
                scores = {name: layer.score(q) for name, layer in layers.items()}
                for name, parts in fusions.items():
                    scores[name] = fuse([scores[l] for l, _ in parts], [w for _, w in parts], db_songs)
                plan = None
                if PLAN_SIZE:
                    others = [x for x in db_songs if x != truth]
                    plan = {truth, *rng.choice(others, PLAN_SIZE - 1, replace=False)}
                for name, s in scores.items():
                    if plan:
                        # Report the full-DB ranking too, so one pass gives both.
                        results[name + " (all)"].append(rank_of(s, truth))
                        s = {k: v for k, v in s.items() if k in plan}  # empty -> miss
                    rk = rank_of(s, truth)
                    results[name].append(rk)
                    per_song[name][truth].append(rk)
        n = len(next(iter(results.values())))
        pool = PLAN_SIZE or len(db_songs)
        print(f"\n=== {win:.0f}s windows, {n} queries, ranked among {pool} songs (chance top-1 {1 / pool:.0%}) ===")
        for name, ranks in results.items():
            ranks = np.array(ranks)
            print(f"{name:18} top1 {np.mean(ranks == 1):6.1%}   top3 {np.mean(ranks <= 3):6.1%}")
        if win == windows[-1]:
            print(f"\nper-song top-1 ({report_on}):")
            for song, ranks in sorted(per_song[report_on].items()):
                ranks = np.array(ranks)
                print(f"  {song:28} {np.mean(ranks == 1):5.0%}  ({len(ranks)} q)")


if __name__ == "__main__":
    main()
