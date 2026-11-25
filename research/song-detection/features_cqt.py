"""Whole-sound spectrum with octaves kept (no AI).

72-bin constant-Q transform, C2 (65 Hz) to B7, one bin per semitone, 100 ms hop.
Unlike chroma, a low D (bass) and a high D (voice) stay in different rows.
Saved as log-magnitude to ~/manna-song-data/cache/features_cqt/<stem>.npz.
"""
import sys
from concurrent.futures import ProcessPoolExecutor

import librosa
import numpy as np

from common import DATA, SR, audio_rows, wav_path
from features import CHROMA_HOP

OUT_DIR = DATA / "cache" / "features_cqt"
N_BINS = 72
FMIN = librosa.note_to_hz("C2")


def job(wav):
    out = OUT_DIR / (wav.stem + ".npz")
    if out.exists():
        return f"cached    {wav.name}"
    y, _ = librosa.load(wav, sr=SR, mono=True)
    c = np.abs(librosa.cqt(y, sr=SR, hop_length=CHROMA_HOP, fmin=FMIN, n_bins=N_BINS, bins_per_octave=12))
    np.savez_compressed(out, cqt=np.log1p(100 * c).astype(np.float32))
    return f"extracted {wav.name}"


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    wavs = sorted({wav_path(r) for r in audio_rows()}, key=lambda p: -p.stat().st_size)
    with ProcessPoolExecutor(int(sys.argv[1]) if len(sys.argv) > 1 else 7) as pool:
        for line in pool.map(job, wavs):
            print(line, flush=True)


if __name__ == "__main__":
    main()
