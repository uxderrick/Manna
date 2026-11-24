"""Turn cached features into song keys (hashes with a time offset). No AI models.

Melody keys: pitch track -> notes -> semitone intervals (+ optional coarse
duration ratios) -> rolling n-gram hashes. Key and tempo drop out because we
store steps and ratios, not notes and seconds.

Harmony keys: chroma -> major/minor triad per frame -> chord segments ->
transitions as (root step mod 12, quality from, quality to) -> n-gram hashes.
Root steps are key-independent, like Roman numerals without key detection.
"""
from dataclasses import dataclass

import numpy as np

F0_FRAME_S = 0.02
CHROMA_FRAME_S = 0.1


@dataclass
class MelodyParams:
    vprob_min: float = 0.3
    stable_semitones: float = 0.7
    min_note_frames: int = 4  # 80 ms
    n: int = 5  # intervals per hash
    use_durations: bool = True
    dur_bins: float = 1.0  # bins per octave of duration ratio


@dataclass
class HarmonyParams:
    smooth_frames: int = 9  # 0.9 s median filter on chord labels
    min_chord_frames: int = 5  # 0.5 s
    n: int = 3  # transitions per hash
    use_durations: bool = False


# ---------------------------------------------------------------- melody


def notes_from_f0(f0, vprob, p: MelodyParams):
    """Return list of (onset_s, dur_s, midi_float)."""
    voiced = (f0 > 0) & (vprob >= p.vprob_min)
    midi = np.where(voiced, 69 + 12 * np.log2(np.maximum(f0, 1e-6) / 440.0), np.nan)
    notes = []
    start, vals = None, []

    def close(end):
        if start is not None and end - start >= p.min_note_frames:
            notes.append((start * F0_FRAME_S, (end - start) * F0_FRAME_S, float(np.median(vals))))

    for i, m in enumerate(midi):
        if np.isnan(m):
            close(i)
            start, vals = None, []
            continue
        if start is not None and abs(m - np.median(vals[-8:])) > p.stable_semitones:
            close(i)
            start, vals = None, []
        if start is None:
            start = i
        vals.append(m)
    close(len(midi))
    return notes


def fold_interval(i: int) -> int:
    # pYIN octave errors show up as +-12 jumps; fold big leaps back into range.
    while i > 9:
        i -= 12
    while i < -9:
        i += 12
    return i


def melody_keys(f0, vprob, p: MelodyParams):
    """Return (hashes int64[], times float[]) for one feature stream."""
    notes = notes_from_f0(f0, vprob, p)
    if len(notes) < p.n + 1:
        return np.empty(0, np.int64), np.empty(0)
    onsets = np.array([n[0] for n in notes])
    durs = np.array([n[1] for n in notes])
    pitch = np.array([n[2] for n in notes])
    ints = [fold_interval(int(round(d))) for d in np.diff(pitch)]
    # inter-onset intervals are steadier than sung note lengths
    ioi = np.diff(onsets)
    hashes, times = [], []
    for k in range(len(ints) - p.n + 1):
        key = tuple(ints[k : k + p.n])
        if p.use_durations:
            r = np.log2(ioi[k + 1 : k + p.n] / ioi[k : k + p.n - 1])
            key += tuple(np.clip(np.round(r * p.dur_bins), -3, 3).astype(int).tolist())
        hashes.append(hash(("m",) + key))
        times.append(onsets[k])
    return np.array(hashes, np.int64), np.array(times)


# ---------------------------------------------------------------- harmony

_TEMPLATES = []
for root in range(12):
    for quality, third in ((0, 4), (1, 3)):  # 0 = major, 1 = minor
        t = np.zeros(12)
        t[[root, (root + third) % 12, (root + 7) % 12]] = 1
        _TEMPLATES.append((root, quality, t / np.linalg.norm(t)))
_TMAT = np.stack([t for _, _, t in _TEMPLATES])


def chord_segments(chroma, p: HarmonyParams):
    """Return list of (onset_s, dur_s, root, quality)."""
    c = chroma / (np.linalg.norm(chroma, axis=0, keepdims=True) + 1e-9)
    energy = chroma.sum(axis=0)
    labels = np.argmax(_TMAT @ c, axis=0)
    labels[energy < 0.05 * np.median(energy + 1e-9)] = -1
    # majority filter
    half = p.smooth_frames // 2
    sm = labels.copy()
    for i in range(len(labels)):
        w = labels[max(0, i - half) : i + half + 1]
        vals, counts = np.unique(w, return_counts=True)
        sm[i] = vals[np.argmax(counts)]
    segs = []
    i = 0
    while i < len(sm):
        j = i
        while j < len(sm) and sm[j] == sm[i]:
            j += 1
        if sm[i] >= 0 and j - i >= p.min_chord_frames:
            root, quality, _ = _TEMPLATES[sm[i]]
            if segs and (segs[-1][2], segs[-1][3]) == (root, quality):
                o, d, r, q = segs[-1]
                segs[-1] = (o, (j * CHROMA_FRAME_S) - o, r, q)
            else:
                segs.append((i * CHROMA_FRAME_S, (j - i) * CHROMA_FRAME_S, root, quality))
        i = j
    return segs


def harmony_keys(chroma, p: HarmonyParams):
    segs = chord_segments(chroma, p)
    if len(segs) < p.n + 1:
        return np.empty(0, np.int64), np.empty(0)
    trans = [
        ((b[2] - a[2]) % 12, a[3], b[3]) for a, b in zip(segs, segs[1:])
    ]
    durs = np.array([s[1] for s in segs])
    hashes, times = [], []
    for k in range(len(trans) - p.n + 1):
        key = tuple(trans[k : k + p.n])
        if p.use_durations:
            r = np.log2(durs[k + 1 : k + p.n + 1] / durs[k : k + p.n])
            key += tuple(np.clip(np.round(r), -2, 2).astype(int).tolist())
        hashes.append(hash(("h",) + key))
        times.append(segs[k][0])
    return np.array(hashes, np.int64), np.array(times)
