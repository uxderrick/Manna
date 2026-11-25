"""Extract and cache raw per-file features (no AI models):

- f0: pYIN pitch track, 20 ms hop (dominant melody of the full mix)
- voiced prob from pYIN
- chroma: 12-bin CQT chroma, 100 ms hop (harmony)

Saved as ~/manna-song-data/cache/features/<stem>.npz. Run once; matching
experiments then reuse the cache.
"""
import sys
from concurrent.futures import ProcessPoolExecutor

import librosa
import numpy as np

from common import FEAT_DIR, SR, audio_rows, wav_path

F0_HOP = 320  # 20 ms
CHROMA_HOP = 1600  # 100 ms


def extract(y):
    f0, voiced, vprob = librosa.pyin(
        y, fmin=65, fmax=1050, sr=SR, frame_length=1024, hop_length=F0_HOP
    )
    chroma = librosa.feature.chroma_cqt(y=y, sr=SR, hop_length=CHROMA_HOP)
    return dict(
        f0=np.nan_to_num(f0).astype(np.float32),
        vprob=vprob.astype(np.float32),
        chroma=chroma.astype(np.float32),
    )


def job(wav):
    out = FEAT_DIR / (wav.stem + ".npz")
    if out.exists():
        return f"cached    {wav.name}"
    y, _ = librosa.load(wav, sr=SR, mono=True)
    np.savez_compressed(out, **extract(y))
    return f"extracted {wav.name} ({len(y) / SR / 60:.1f} min)"


def main():
    FEAT_DIR.mkdir(parents=True, exist_ok=True)
    wavs = sorted({wav_path(r) for r in audio_rows()}, key=lambda p: -p.stat().st_size)
    workers = int(sys.argv[1]) if len(sys.argv) > 1 else 7
    with ProcessPoolExecutor(workers) as pool:
        for line in pool.map(job, wavs):
            print(line, flush=True)


if __name__ == "__main__":
    main()
