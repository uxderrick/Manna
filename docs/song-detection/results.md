# Song Detection: Prototype Results (Phase 2)

Date: 2026-11-24. Code: [research/song-detection](../../research/song-detection/).

## Test setup
- **Database:** 25 reference recordings of 22 songs (`songs/va`), including trap pairs.
- **Queries:** clips cut from 26 *other* recordings of the same songs (`songs/vb`), never in the
  database. That's about 250 clips per clip length.
- **Measures:** **top-1** (the first guess is right) and **top-3** (the right song is in the
  first three, which is what an operator "pick one" chip needs).
- **With plan:** each clip is ranked against its true song plus 5 random others, simulating a
  6-song service plan. Random guessing scores 5% across all 22 songs and 17% with a 6-song plan.
- **Caveat:** all queries are clean studio, live or YouTube recordings. Phone recordings in the
  room have not been tested yet; they are the real go/no-go.

## Success criteria
| Metric | Target |
|---|---|
| Right first guess, with plan, **10 s** of audio | ≥ 85% |
| Right song in top 3, with plan, 10 s | ≥ 95% |
| Song not in the database | "No match" ≥ 90% of the time |
| Sermon, prayer, announcements | < 1 false song alert per hour |

10 s is the target because a 30 s detection is no faster than the operator.

## Results at 10 s

| Method | All 22: top-1 | All 22: top-3 | With plan: top-1 | With plan: top-3 |
|---|---|---|---|---|
| Melody hashes (pitch tracked from the full mix) | 0% | 0% | — | — |
| Chord hashes | 13% | 25% | 23% | 43% |
| Chroma alignment | 29% | 47% | 49% | 80% |
| CQT alignment (keeps octaves) | 30% | 44% | 46% | 69% |
| Chroma + CQT | 35% | 52% | 51% | 79% |
| **CoverHunter** (pretrained, research only) | **59%** | **78%** | **75%** | **91%** |
| CoverHunter + chroma + CQT | 65% | 77% | 76% | 92% |
| **CLEWS** (Sony, MIT, segment-based) | **85%** | **92%** | **89%** | **98%** |
| **CLEWS + chroma + CQT** | 81% | 91% | **90%** | 97% |

At 5 s with the plan, the CoverHunter combination gets 60% top-1 and 87% top-3; CLEWS alone gets
75% top-1 and 92% top-3. **CLEWS passes both 10 s targets on clean recordings.** Every song is at
75% or better with the plan; the hard ones improved most (God Will Make a Way 81%, Raise a
Hallelujah 78%).

CLEWS cost on this Intel Mac CPU: 197 M parameters (787 MB at full precision) and 2.7 s per clip
in PyTorch. CoverHunter is 6 M parameters and 0.06 s. References are embedded once (20 s segments
every 10 s) and cached.

**Shippable form (`clews_export.py`):** ONNX, with input = raw 16 kHz audio in a fixed 20 s window,
so the CQT is inside the graph. Output = a normalised 1024-d vector. Manna can run this through
`ort`.

| Variant | Size | Speed per window (6 / 2 threads) | 10 s, plan: top-1 / top-3 | All 22: top-1 / top-3 |
|---|---|---|---|---|
| PyTorch | 787 MB | 2.7 s | 88.7% / 98.1% | 85.2% / 92.2% |
| ONNX fp32 | 798 MB | 0.37 / 0.60 s | identical (cosine 1.000) | |
| **ONNX 8-bit, static, calibrated on songs** | **208 MB** | **0.27 / 0.45 s** | **91.4% / 98.1%** | 83.7% / 92.6% |

- The 8-bit model keeps the CQT filter bank at full precision.
- On music it agrees with full precision at cosine 0.989 (lowest 0.943). Random noise is not a
  valid test here: the quick dynamic 8-bit model looked broken on noise (0.75) but was fine on
  music (0.973).
- Scoring every 2 s on 2 threads uses about a quarter of two cores, leaving room for Whisper.

## Live listening (`stream_eval.py`)
This simulates a song starting and the engine re-scoring every 2 s on the last 4–15 s of audio:
91 starts from 26 recordings, with a 6-song plan. It reports how long until a confident commit,
how often the commit is wrong, and how often a song that is **not** in Manna gets committed to
anyway.

| Policy | Correct by 10 s | by 14 s | by 20 s | Wrong | Song not in Manna → false pick |
|---|---|---|---|---|---|
| Fused layers, commit at any time (margin 1.0) | 59% | — | 77% | 16% | 41% |
| **CLEWS only, from 6 s, margin 0.2** | **59%** | **70%** | **75%** | **1%** | **4%** |

- **Per-moment accuracy is already high.** CLEWS ranks the right song first for 85% of streams at
  10 s and 90% from 14 s. The losses came from committing on short, noisy early windows.
- **The tuned policy rarely commits wrong**, and almost never mistakes an unknown song for a known
  one. About 25% of starts stay undecided at 20 s. For those, the operator gets the top-3 chip,
  which holds the right song 98% of the time at 10 s.
- **The policy was tuned on these same streams, so it is optimistic.** Phone recordings in church
  are the real test.
- **Raw similarities are not yet used.** The cohort-normalised "absolute strength" turned out to
  be poorly scaled for CLEWS (true song median 0.59 vs best wrong 0.36). A raw-cosine rejection
  rule is a likely improvement.

## What we learned
1. **Melody can't be heard inside a band without separating the voice.** A pitch tracker on the
   full mix follows the bass. With the bass filtered out it lands in the singing range, but
   still jumps between voice, keys and guitar. Melody alignment reached only 9% top-1 at 30 s.
   It stays as a later add-on: after vocal separation (Demucs, MIT) or for a cappella choir.
2. **The "whole sound" beats picking out one line.** Chroma and CQT alignment are the best
   methods without AI.
3. **Long reference recordings biased the scores** toward themselves. Normalising each
   reference against how it scores on *other* songs (cohort normalisation) removed the bias,
   but did not raise overall accuracy.
4. **Without AI, accuracy levels off at about 50% top-1 with the plan at 10 s.** 10 s of chord
   colour is not distinctive enough on its own.
5. **A cover-song embedding closes most of the gap with no training on our music.** CoverHunter
   was trained on Western pop covers in 2-minute chunks, yet reaches 76% top-1 and 92% top-3
   with the plan at 10 s.
6. **Some failures are data gaps, not method failures:**
   - Raise a Hallelujah has only 30 s previews of the original.
   - Great Is Thy Faithfulness has only a 1940s 78 rpm reference.
   - God Will Make a Way's covers include Japanese and mass-choir versions.

## Decision: models and training
- **Plan:** an AI cover-song embedding as the main layer, with Manna's own system around it
  (plan prior, meter filter, fusion, operator top-3).
- **Lead model: CLEWS** (github.com/sony/clews; code and checkpoints stated MIT on Zenodo record
  15045900). Its training data (Discogs-VI / SHS100K, YouTube audio) carries non-commercial
  research terms, and the authors don't say whether those reach the weights. That's low risk
  in-house, but confirm with Sony before any commercial release.
- **Engineering work: size and speed.** Try 8-bit quantisation and ONNX export first. Then
  distil CLEWS into a small model (CoverHunter-sized) using CLEWS as the teacher. This is where
  our own training comes in.
- **No song-specific training:** adding a song is enrolment (compute and store its keys).
- **Licensing:** CoverHunter's code and weights have **no licence**, so they cannot ship, even
  in-house. Options:
  1. Ask the author for permission.
  2. Use a properly licensed cover-song model. Candidates such as Discogs-VINet and CLEWS still
     need their licences checked. Non-commercial licences are acceptable while Manna stays
     in-house.
  3. Re-implement the published architecture and train it ourselves on short (5–15 s) clips,
     including gospel and worship music. Now superseded by CLEWS plus distillation.

## Next steps
1. Record phone clips in church (sung, keyboard, full band), about 3 per song, and re-run.
   This is the go/no-go.
2. Test continuous listening: seconds until a confident, correct detection.
3. Add more references per song to the database, including full originals for the songs
   with data gaps.
4. Pick the licensing route for the embedding layer.
