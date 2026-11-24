"""Live-listening simulation: how fast does a confident, correct detection come?

For each query recording (songs/vb) and a few start points, pretend the song
starts there and the matcher re-scores every CHECKPOINT seconds on the most
recent audio (up to MAX_WINDOW_S). At each checkpoint it ranks the candidates
and records the winner and its margin over the runner-up (fused z-scores).

Two scenarios per stream:
- known:   candidates = true song + (PLAN_SIZE-1) random others (song is in the plan)
- unknown: candidates = PLAN_SIZE random others (song is NOT in Manna) - any
           commit is a false alarm.

A commit happens the first time the margin is >= threshold at CONFIRM
consecutive checkpoints with the same winner. Thresholds are swept afterwards,
giving the speed / false-alarm trade-off.

Usage (CoverHunter needs .venv-ch):
    LAYERS=coverhunter,chroma-align,cqt-align ~/manna-song-data/.venv-ch/bin/python stream_eval.py
"""
import json
import os
from collections import defaultdict
from pathlib import Path

import numpy as np

import evaluate as E
from common import DATA, audio_rows, split_of

CHECKPOINTS = [4, 6, 8, 10, 12, 14, 16, 20]
MAX_WINDOW_S = 15.0
STREAM_STARTS = [0, 30, 60, 90]
PLAN_SIZE = int(os.environ.get("PLAN_SIZE", "6"))
CONFIRM = int(os.environ.get("CONFIRM", "2"))
THRESHOLDS = [0.0, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0]
OUT = DATA / "cache" / "stream_eval.json"

WEIGHTS = {"coverhunter": 1.0, "clews": 1.0, "chroma-align": 0.5, "cqt-align": 0.5}
ABS_THRESHOLDS = [None, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0]
MAX_WRONG = float(os.environ.get("MAX_WRONG", "0.05"))
MAX_UNKNOWN = float(os.environ.get("MAX_UNKNOWN", "0.05"))


def window_len(t):
    return min(float(t), MAX_WINDOW_S)


def collect():
    enabled = os.environ.get("LAYERS", "coverhunter,chroma-align,cqt-align").split(",")
    layers = {k: v for k, v in E.make_layers(enabled).items() if k in enabled}
    rows = audio_rows()
    db_rows = [r for r in rows if split_of(r) == "va"]
    q_rows = [r for r in rows if split_of(r) == "vb"]
    db_feats = []
    for r in db_rows:
        f = E.load_feats(r)
        db_feats.append((r["song_slug"], f))
        for layer in layers.values():
            layer.add(r["song_slug"], Path(r["path"]).stem, f)
    for layer in layers.values():
        layer.finalize()
    songs = sorted({r["song_slug"] for r in db_rows})
    rng = np.random.default_rng(0)

    streams = []
    q_feats = [(r, E.load_feats(r)) for r in q_rows if r["song_slug"] in songs]
    for r, f in q_feats:
        dur = len(f["f0"]) * E.F0_FRAME_S
        for start in STREAM_STARTS:
            if start + CHECKPOINTS[-1] <= dur:
                others = [s for s in songs if s != r["song_slug"]]
                streams.append({
                    "file": Path(r["path"]).stem,
                    "truth": r["song_slug"],
                    "start": start,
                    "known_plan": [r["song_slug"], *rng.choice(others, PLAN_SIZE - 1, replace=False).tolist()],
                    "unknown_plan": rng.choice(others, PLAN_SIZE, replace=False).tolist(),
                    "steps": [],
                })
    print(f"{len(streams)} streams from {len(q_feats)} recordings, {len(songs)} songs in DB", flush=True)

    feats_by_file = {Path(r["path"]).stem: f for r, f in q_feats}
    # Score by window length so each layer calibrates / caches once per length.
    for win in sorted({window_len(t) for t in CHECKPOINTS}):
        for name, layer in layers.items():
            if "align" in name or name == "coverhunter":
                layer.calibrate(db_feats, win)
        print(f"window {win:.0f}s", flush=True)
        for s in streams:
            f = feats_by_file[s["file"]]
            for t in CHECKPOINTS:
                if window_len(t) != win:
                    continue
                t1 = s["start"] + t
                q = E.slice_feats(f, t1 - win, t1)
                scores = {n: layer.score(q) for n, layer in layers.items()}
                fused = E.fuse([scores[n] for n in layers], [WEIGHTS.get(n, 1.0) for n in layers], songs)
                # Cohort-normalised layer scores are already comparable across
                # queries, so their weighted sum keeps absolute strength.
                absolute = {k: sum(WEIGHTS.get(n, 1.0) * scores[n].get(k, -3.0) for n in layers) / sum(WEIGHTS.get(n, 1.0) for n in layers) for k in songs}
                s["steps"].append({"t": t, "scores": fused, "abs": absolute, "layers": {n: scores[n] for n in layers}})
    for s in streams:
        s["steps"].sort(key=lambda x: x["t"])
    OUT.write_text(json.dumps({"songs": songs, "streams": streams}))
    print(f"saved {OUT}")


def decide(steps, plan, threshold, abs_threshold=None):
    """(commit_time, song) or (None, None). Needs a margin over the runner-up
    and, when `abs_threshold` is set, an absolutely strong top match."""
    run_song, run_len = None, 0
    for step in steps:
        ranked = sorted(((step["scores"].get(c, -9.0), c) for c in plan), reverse=True)
        (best, song), (second, _) = ranked[0], ranked[1]
        strong = abs_threshold is None or step.get("abs", {}).get(song, -9.0) >= abs_threshold
        if best - second >= threshold and strong:
            run_len = run_len + 1 if song == run_song else 1
            run_song = song
            if run_len >= CONFIRM:
                return step["t"], song
        else:
            run_song, run_len = None, 0
    return None, None


def report():
    data = json.loads(OUT.read_text())
    streams = data["streams"]
    n = len(streams)
    print(f"\n{n} streams, plan of {PLAN_SIZE}, commit after {CONFIRM} agreeing checkpoints "
          f"(every 2 s, window up to {MAX_WINDOW_S:.0f} s)\n")
    print(f"{'margin':>6} | {'correct by 6s':>13} {'by 10s':>7} {'by 20s':>7} | {'wrong':>6} | "
          f"{'median t':>8} | {'unknown song: false commit':>26}")
    for th in THRESHOLDS:
        correct_t, wrong, unknown_fp = [], 0, 0
        for s in streams:
            t, song = decide(s["steps"], s["known_plan"], th)
            if song == s["truth"]:
                correct_t.append(t)
            elif song is not None:
                wrong += 1
            t2, song2 = decide(s["steps"], s["unknown_plan"], th)
            if song2 is not None:
                unknown_fp += 1
        ct = np.array(correct_t)
        by = lambda lim: np.sum(ct <= lim) / n if len(ct) else 0.0  # noqa: E731
        med = f"{np.median(ct):.0f}s" if len(ct) else "-"
        print(f"{th:>6.2f} | {by(6):>13.0%} {by(10):>7.0%} {by(20):>7.0%} | {wrong / n:>6.0%} | "
              f"{med:>8} | {unknown_fp / n:>26.0%}")

    print(f"\nbest operating points (wrong <= {MAX_WRONG:.0%}, unknown false commit <= {MAX_UNKNOWN:.0%}):")
    points = []
    for th in THRESHOLDS:
        for ab in ABS_THRESHOLDS:
            ok_t, wrong, fp = [], 0, 0
            for s in streams:
                t, song = decide(s["steps"], s["known_plan"], th, ab)
                if song == s["truth"]:
                    ok_t.append(t)
                elif song is not None:
                    wrong += 1
                fp += decide(s["steps"], s["unknown_plan"], th, ab)[1] is not None
            ct = np.array(ok_t)
            points.append((np.sum(ct <= 10) / n, np.sum(ct <= 20) / n, wrong / n, fp / n, th, ab))
    good = sorted([p for p in points if p[2] <= MAX_WRONG and p[3] <= MAX_UNKNOWN], reverse=True)[:5]
    for by10, by20, w, fp, th, ab in good or sorted(points, key=lambda p: p[2] + p[3])[:5]:
        print(f"  margin {th:.2f} abs {ab}: correct by 10s {by10:.0%}, by 20s {by20:.0%}, wrong {w:.0%}, unknown false {fp:.0%}")

    per = defaultdict(list)
    for s in streams:
        t, song = decide(s["steps"], s["known_plan"], 1.0)
        per[s["truth"]].append(t if song == s["truth"] else None)
    print("\nper song at margin 1.0: correct commits (median time)")
    for song, ts in sorted(per.items()):
        ok = [t for t in ts if t is not None]
        med = f"{np.median(ok):.0f}s" if ok else "-"
        print(f"  {song:28} {len(ok)}/{len(ts)}  ({med})")


if __name__ == "__main__":
    if not OUT.exists() or os.environ.get("RECOLLECT") == "1":
        collect()
    report()
