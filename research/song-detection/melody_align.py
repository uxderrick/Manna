"""Tolerant melody matching: voice pitch -> 12-bin 'melody chroma' (one pitch
class per frame, weighted by voicing), then the same key-shift + subsequence
DTW alignment as align.py. Wrong notes cost a little instead of breaking a hash."""
import numpy as np

from align import AlignIndex

F0_PER_CHROMA = 5  # 20 ms f0 frames -> 100 ms, matching chroma frame rate


def melody_chroma(f0, vprob):
    n = len(f0) // F0_PER_CHROMA
    m = np.zeros((12, n), np.float32)
    ok = (f0 > 0) & (vprob > 0.3)
    pc = np.round(12 * np.log2(np.maximum(f0, 1e-6) / 440.0)).astype(int) % 12
    for i in np.nonzero(ok[: n * F0_PER_CHROMA])[0]:
        m[pc[i], i // F0_PER_CHROMA] += vprob[i]
    return m  # unvoiced frames stay zero -> cosine cost 1, never a free match


class MelodyAlignIndex(AlignIndex):
    pass
