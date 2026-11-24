"""Whole-sound alignment on the 72-bin CQT (octaves kept). No AI.

Same idea as align.py, but each frame is the full note spectrum (C2-B7),
so bass, keys and voice sit at different heights instead of being folded
into 12 pitch classes.

- whiten: subtract each recording's per-bin mean, removing EQ / room / mic
  colour so two recordings of the same notes look alike.
- key: candidate transpositions come from the folded chroma (OTI); each is
  tried as a vertical shift of -6..+5 semitones and the octave alternative.
- tempo: subsequence DTW, as in align.py.
"""
import librosa
import numpy as np

POOL = 5  # 100 ms -> 0.5 s
OTI_TRIED = 2


def prep(cqt, whiten):
    n = cqt.shape[1] // POOL
    x = cqt[:, : n * POOL].reshape(cqt.shape[0], n, POOL).mean(axis=2)
    if whiten:
        x = x - x.mean(axis=1, keepdims=True)
        x = np.maximum(x, 0)  # keep only notes louder than this recording's usual level
    return x / (np.linalg.norm(x, axis=0, keepdims=True) + 1e-9)


def folded_profile(x):
    p = np.zeros(12)
    for b in range(x.shape[0]):
        p[b % 12] += x[b].sum()
    return p / (np.linalg.norm(p) + 1e-9)


def shift_rows(x, s):
    """out[b] = x[b + s] (zero where out of range)."""
    out = np.zeros_like(x)
    if s >= 0:
        out[: x.shape[0] - s] = x[s:]
    else:
        out[-s:] = x[: x.shape[0] + s]
    return out


class CqtAlignIndex:
    def __init__(self, whiten=True):
        self.whiten = whiten
        self.refs = []

    def add(self, song, cqt):
        x = prep(cqt, self.whiten)
        self.refs.append((song, x, folded_profile(x)))

    def score(self, cqt):
        q = prep(cqt, self.whiten)
        if q.shape[1] < 4:
            return {}
        qp = folded_profile(q)
        best = {}
        for song, r, rp in self.refs:
            ks = np.argsort([-np.dot(qp, np.roll(rp, -k)) for k in range(12)])[:OTI_TRIED]
            shifts = {int(k) for k in ks} | {int(k) - 12 for k in ks}
            s_best = 0.0
            for s in shifts:
                if abs(s) > 9:
                    continue
                rr = shift_rows(r, s)
                rr = rr / (np.linalg.norm(rr, axis=0, keepdims=True) + 1e-9)
                cost = 1 - q.T @ rr
                D, wp = librosa.sequence.dtw(C=cost, subseq=True, backtrack=True)
                s_best = max(s_best, 1 - D[-1, wp[0, 1]] / len(wp))
            best[song] = max(best.get(song, 0.0), s_best)
        return best
