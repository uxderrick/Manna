# Song detection prototype (offline research)

Python experiments behind [docs/song-detection](../../docs/song-detection/). Nothing here
ships in Manna. Results are written up in
[results.md](../../docs/song-detection/results.md).

## Data (never committed)

- Reference audio: `songs/va` (database references, plus trap songs) and `songs/vb` (other
  renditions, used as queries), at the repo root. `/songs/` is gitignored.
- `~/manna-song-data/manifest.csv` maps each file to a `song_slug`. Feature caches go in
  `~/manna-song-data/cache/`.

## Setup

```bash
uv venv ~/manna-song-data/.venv --python 3.12
# Intel Macs: newer numba/llvmlite have no x86_64 wheels, so pin them
uv pip install --python ~/manna-song-data/.venv/bin/python \
  numpy scipy soundfile 'librosa==0.10.2.post1' 'numba==0.60.0' 'llvmlite==0.43.0'
```

## Pipeline

```bash
PY=~/manna-song-data/.venv/bin/python
$PY prep.py            # decode to 16 kHz mono WAV (macOS afconvert)
$PY features.py        # pYIN pitch + chroma
$PY features_voice.py  # pitch with the bass filtered out (melody experiment)
$PY features_cqt.py    # 72-bin CQT (whole-sound layer)

# Clip lengths are arguments; LAYERS picks the methods; PLAN_SIZE simulates a service plan
LAYERS=harmony,chroma-align,cqt-align PLAN_SIZE=6 $PY evaluate.py 5 10
```

| File | Layer |
|---|---|
| `keys.py` | Exact melody and chord hashes (Shazam-style voting) |
| `align.py` | Chroma, with tolerance for key and tempo changes (subsequence DTW) |
| `cqt_align.py` | The same alignment on the CQT, which keeps octaves, with each recording's tone colour removed |
| `melody_align.py` | Melody pitch-class alignment |
| `coverhunter.py` | Pretrained CoverHunter embedding, used **as a benchmark only** |

## CoverHunter (research only)

The CoverHunter repo and weights have **no licence**, so this layer can be used for
local measurement only and must never ship in Manna. It needs a separate environment
(PyTorch 2.2 is the last release with Intel Mac wheels):

```bash
uv venv ~/manna-song-data/.venv-ch --python 3.11
uv pip install --python ~/manna-song-data/.venv-ch/bin/python 'torch==2.2.2' 'numpy<2' \
  'librosa==0.10.2.post1' 'numba==0.60.0' 'llvmlite==0.43.0' scipy pyyaml 'typeguard==2.13.3' gdown
git clone https://github.com/Liu-Feng-deeplearning/CoverHunter ~/manna-song-data/models/CoverHunter
# Download the pretrained model linked in its README, then extract it to
# ~/manna-song-data/models/coverhunter-weights/pretrain_model
~/manna-song-data/.venv-ch/bin/python coverhunter.py   # cache its CQT
LAYERS=coverhunter,chroma-align,cqt-align PLAN_SIZE=6 \
  ~/manna-song-data/.venv-ch/bin/python evaluate.py 5 10
```
