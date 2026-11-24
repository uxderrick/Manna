"""Dump clips and their Python ONNX embeddings for the Rust parity test.

Writes ~/manna-song-data/cache/rust-parity/:
- audio.f32 / audio.json: a few clips (16 kHz mono) of different lengths
- query.f32: Python's embedding of each clip as one repeat-padded window
- reference.f32 / reference.json: one recording embedded as 20 s shingles
  every 10 s, as the Rust `embed_reference` does

The Rust test `onnx_matches_python` (crates/songmatch/tests/onnx_parity.rs)
runs the same model through `ort` and compares.

    ~/manna-song-data/.venv-ch/bin/python export_onnx_parity.py [model.onnx]
"""
import json
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
import soundfile as sf

from common import DATA

SR = 16000
WIN = 20 * SR
OUT = DATA / "cache" / "rust-parity"
MODEL = Path(sys.argv[1]) if len(sys.argv) > 1 else DATA / "models" / "clews-onnx" / "clews_int8_static.onnx"


def repeat_pad(x, n):
    return np.tile(x, int(np.ceil(n / max(len(x), 1))))[:n]


def unit(v):
    return v / np.linalg.norm(v, axis=-1, keepdims=True)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    sess = ort.InferenceSession(str(MODEL), providers=["CPUExecutionProvider"])
    embed = lambda frames: unit(sess.run(None, {"audio": np.stack(frames).astype(np.float32)})[0])

    wav = sf.read(sorted((DATA / "cache" / "wav16k").glob("*.wav"))[0], dtype="float32")[0]
    clips = [wav[30 * SR : 30 * SR + int(s * SR)] for s in (4, 9.5, 15)]
    np.concatenate(clips).astype(np.float32).tofile(OUT / "audio.f32")
    (OUT / "audio.json").write_text(json.dumps({"lengths": [len(c) for c in clips], "model": str(MODEL)}))
    np.stack([embed([repeat_pad(c, WIN)])[0] for c in clips]).astype(np.float32).tofile(OUT / "query.f32")

    ref = wav[: 75 * SR]
    starts = range(0, max(len(ref) - WIN, 0) + 1, 10 * SR)
    frames = [repeat_pad(ref[s : s + WIN], WIN) for s in starts]
    ref.astype(np.float32).tofile(OUT / "reference_audio.f32")
    embed(frames).astype(np.float32).tofile(OUT / "reference.f32")
    (OUT / "reference.json").write_text(json.dumps({"windows": len(frames)}))
    print(f"{len(clips)} clips, {len(frames)} reference windows -> {OUT}")


if __name__ == "__main__":
    main()
