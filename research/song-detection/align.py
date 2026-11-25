"""Chroma alignment layer (classic, no AI): the pre-deep-learning cover-song method.

Query and reference chroma are pooled to 0.5 s frames and L2-normalised.
Key: try the reference transposed by the best few shifts (optimal transposition
index from mean chroma). Tempo: subsequence DTW lets the query stretch along
any part of the reference. Score = 1 - mean cosine cost on the best path.
"""
import librosa
import numpy as np

POOL = 5  # 100 ms chroma frames -> 0.5 s
SHIFTS_TRIED = 3


def pool(chroma):
    n = chroma.shape[1] // POOL
    c = chroma[:, : n * POOL].reshape(12, n, POOL).mean(axis=2)
    return c / (np.linalg.norm(c, axis=0, keepdims=True) + 1e-9)


class AlignIndex:
    def __init__(self):
        self.refs = []  # (song, pooled chroma, mean profile)

    def add(self, song, chroma):
        c = pool(chroma)
        m = c.mean(axis=1)
        self.refs.append((song, c, m / (np.linalg.norm(m) + 1e-9)))

    def score(self, chroma):
        q = pool(chroma)
        if q.shape[1] < 4:
            return {}
        qm = q.mean(axis=1)
        qm /= np.linalg.norm(qm) + 1e-9
        best = {}
        for song, r, rm in self.refs:
            oti = np.argsort([-np.dot(qm, np.roll(rm, s)) for s in range(12)])[:SHIFTS_TRIED]
            s_best = 0.0
            for s in oti:
                rr = np.roll(r, s, axis=0)
                cost = 1 - q.T @ rr  # cosine distance, (nq, nr)
                D, wp = librosa.sequence.dtw(C=cost, subseq=True, backtrack=True)
                s_best = max(s_best, 1 - D[-1, wp[0, 1]] / len(wp))
            best[song] = max(best.get(song, 0.0), s_best)
        return best
