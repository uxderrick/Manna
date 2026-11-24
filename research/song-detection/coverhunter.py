"""CoverHunter (pretrained, SHS100K) as a research-only benchmark layer.

License: the CoverHunter repo and weights carry no license, so this is local
measurement only and must never ship in Manna.

Pipeline matches the repo's inference path: 16 kHz audio, peak-normalised,
96-bin CQT (32 Hz up, 12 bins/oct, 40 ms hop) in dB relative to the file max,
averaged in time by 3 (mean_size), then Model.compute_embed -> 128-d vector.

Run directly to cache the CQT for every manifest file:
    ~/manna-song-data/.venv-ch/bin/python coverhunter.py
"""
import sys
from concurrent.futures import ProcessPoolExecutor

import numpy as np

from common import DATA, SR, audio_rows, wav_path

REPO = DATA / "models" / "CoverHunter"
WEIGHTS = DATA / "models" / "coverhunter-weights" / "pretrain_model"
CQT_DIR = DATA / "cache" / "features_chcqt"
FRAME_S = 0.04
MEAN_SIZE = 3

if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))


def compute_cqt(wav):
    import librosa
    from src.cqt import PyCqt

    y, _ = librosa.load(wav, sr=SR, mono=True)
    y = y / max(0.001, np.max(np.abs(y))) * 0.999
    return PyCqt(sample_rate=SR, hop_size=FRAME_S).compute_cqt(signal_float=y, feat_dim_first=False).astype(np.float32)


def _cache_job(wav):
    out = CQT_DIR / (wav.stem + ".npy")
    if not out.exists():
        np.save(out, compute_cqt(wav))
    return wav.name


def load_model():
    import torch
    import src.loss
    from src.utils import load_hparams

    class _NoCenterLoss(torch.nn.Module):  # repo's CenterLoss calls .cuda() at init
        def __init__(self, *a, **k):
            super().__init__()

    src.loss.CenterLoss = _NoCenterLoss
    import src.model

    src.model.CenterLoss = _NoCenterLoss
    hp = load_hparams(str(WEIGHTS / "config" / "hparams.yaml"))
    model = src.model.Model(hp)
    state = torch.load(WEIGHTS / "pt_model" / "g_00000040", map_location="cpu", weights_only=True)["generator"]
    own = model.state_dict()
    missing = [k for k in own if k not in state]
    model.load_state_dict({k: v for k, v in state.items() if k in own}, strict=False)
    if missing:
        print("coverhunter: params not in checkpoint:", missing, file=sys.stderr)
    model.eval()
    torch.set_num_threads(6)
    return model


class CoverHunterIndex:
    """Reference = sliding windows the same length as the query; song score =
    best cosine similarity between the query and any window of that song."""

    def __init__(self):
        self.model = load_model()
        self.refs = []  # (song, cqt [T, 96])
        self.cache = {}  # window frames -> (songs list, embeddings [N, 128])

    def embed(self, feats):
        import torch

        x = [f[: len(f) // MEAN_SIZE * MEAN_SIZE].reshape(-1, MEAN_SIZE, f.shape[1]).mean(axis=1) for f in feats]
        out = []
        for i in range(0, len(x), 32):
            batch = torch.from_numpy(np.stack(x[i : i + 32])).float()
            out.append(self.model.compute_embed(batch).numpy())
        e = np.concatenate(out)
        return e / (np.linalg.norm(e, axis=1, keepdims=True) + 1e-9)

    def add(self, song, cqt):
        self.refs.append((song, cqt))

    def _ref_windows(self, n):
        if n not in self.cache:
            songs, wins = [], []
            hop = max(n // 2, 1)
            for song, c in self.refs:
                starts = range(0, max(len(c) - n, 0) + 1, hop)
                for s in starts:
                    w = c[s : s + n]
                    if len(w) < n:
                        w = np.pad(w, ((0, n - len(w)), (0, 0)), constant_values=-100)
                    songs.append(song)
                    wins.append(w)
            self.cache[n] = (songs, self.embed(wins))
        return self.cache[n]

    def score(self, cqt):
        n = len(cqt)
        if n < MEAN_SIZE * 4:
            return {}
        songs, ref = self._ref_windows(n)
        sims = ref @ self.embed([cqt])[0]
        best = {}
        for song, s in zip(songs, sims.tolist()):
            if s > best.get(song, -1):
                best[song] = s
        return best


def main():
    CQT_DIR.mkdir(parents=True, exist_ok=True)
    wavs = sorted({wav_path(r) for r in audio_rows()}, key=lambda p: -p.stat().st_size)
    with ProcessPoolExecutor(6) as pool:
        for name in pool.map(_cache_job, wavs):
            print("cqt", name, flush=True)


if __name__ == "__main__":
    main()
