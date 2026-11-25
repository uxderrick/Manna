"""Experiment: melody pitch with the bass removed (no AI).

High-pass the mix at 150 Hz and search pitch only in the singing range
(140-1050 Hz), so pYIN stops locking onto the bass guitar.
Saved to ~/manna-song-data/cache/features_voice/<stem>.npz (f0, vprob).
"""
import sys
from concurrent.futures import ProcessPoolExecutor

import librosa
import numpy as np
from scipy.signal import butter, sosfiltfilt

from common import DATA, SR, audio_rows, wav_path
from features import F0_HOP

OUT_DIR = DATA / "cache" / "features_voice"
HIGHPASS = butter(6, 150, btype="highpass", fs=SR, output="sos")


def job(wav):
    out = OUT_DIR / (wav.stem + ".npz")
    if out.exists():
        return f"cached    {wav.name}"
    y, _ = librosa.load(wav, sr=SR, mono=True)
    y = sosfiltfilt(HIGHPASS, y).astype(np.float32)
    f0, _, vprob = librosa.pyin(y, fmin=140, fmax=1050, sr=SR, frame_length=1024, hop_length=F0_HOP)
    np.savez_compressed(out, f0=np.nan_to_num(f0).astype(np.float32), vprob=vprob.astype(np.float32))
    return f"extracted {wav.name}"


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    wavs = sorted({wav_path(r) for r in audio_rows()}, key=lambda p: -p.stat().st_size)
    with ProcessPoolExecutor(int(sys.argv[1]) if len(sys.argv) > 1 else 7) as pool:
        for line in pool.map(job, wavs):
            print(line, flush=True)


if __name__ == "__main__":
    main()
