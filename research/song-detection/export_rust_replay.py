"""Dump real CLEWS embeddings so the Rust engine can replay the live test.

Writes ~/manna-song-data/cache/rust-replay/{refs,queries}.{json,f32}:
- refs: every songs/va reference as 20 s shingles every 10 s (cached ONNX 8-bit)
- queries: the 91 stream_eval song starts; at each checkpoint t (s after the
  song starts) the last min(t, 15) s embedded as one window; with each
  stream's known and unknown 6-song plans (same seed as stream_eval.py).

The Rust test `replay_research_streams` (ignored by default) reads these.

    CLEWS_BACKEND=clews_int8_static ~/manna-song-data/.venv-ch/bin/python export_rust_replay.py
"""
import json
from pathlib import Path

import numpy as np
import soundfile as sf

from clews_layer import ClewsIndex
from common import DATA, audio_rows, split_of, wav_path
from stream_eval import CHECKPOINTS, PLAN_SIZE, STREAM_STARTS, window_len

OUT = DATA / "cache" / "rust-replay"


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    idx = ClewsIndex()
    rows = audio_rows()
    refs, ref_vecs = [], []
    for r in rows:
        if split_of(r) != "va":
            continue
        idx.songs, idx.embs = [], []
        stem = Path(r["path"]).stem
        idx.add(r["song_slug"], stem, sf.read(wav_path(r), dtype="float32")[0])
        e = idx.embs[0].astype(np.float32)
        refs.append({"id": stem, "song": r["song_slug"], "count": len(e)})
        ref_vecs.append(e)
    np.concatenate(ref_vecs).tofile(OUT / "refs.f32")
    (OUT / "refs.json").write_text(json.dumps(refs))

    songs = sorted({r["song"] for r in refs})
    rng = np.random.default_rng(0)  # same draws as stream_eval.collect()
    streams, q_vecs = [], []
    for r in rows:
        if split_of(r) != "vb" or r["song_slug"] not in songs:
            continue
        wav = sf.read(wav_path(r), dtype="float32")[0]
        dur = len(wav) / 16000
        for start in STREAM_STARTS:
            if start + CHECKPOINTS[-1] > dur:
                continue
            others = [s for s in songs if s != r["song_slug"]]
            known = [r["song_slug"], *rng.choice(others, PLAN_SIZE - 1, replace=False).tolist()]
            unknown = rng.choice(others, PLAN_SIZE, replace=False).tolist()
            for t in CHECKPOINTS:
                w = window_len(t)
                t1 = start + t
                clip = wav[int((t1 - w) * 16000): int(t1 * 16000)]
                q_vecs.append(idx._embed(clip, w, w)[0].astype(np.float32))
            streams.append({"truth": r["song_slug"], "known": known, "unknown": unknown, "checkpoints": CHECKPOINTS})
    np.stack(q_vecs).tofile(OUT / "queries.f32")
    (OUT / "queries.json").write_text(json.dumps(streams))
    print(f"{len(refs)} references, {len(streams)} streams x {len(CHECKPOINTS)} checkpoints -> {OUT}")


if __name__ == "__main__":
    main()
