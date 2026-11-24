# Song Detection: Prototype Results (Phase 2, first pass)

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
| **CoverHunter + chroma + CQT** | **65%** | 77% | **76%** | **92%** |

At 5 s with the plan, the CoverHunter combination gets 60% top-1 and 87% top-3.

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
- **No song-specific training:** adding a song is enrolment (compute and store its keys).
- **Licensing:** CoverHunter's code and weights have **no licence**, so they cannot ship, even
  in-house. Options:
  1. Ask the author for permission.
  2. Use a properly licensed cover-song model. Candidates such as Discogs-VINet and CLEWS still
     need their licences checked. Non-commercial licences are acceptable while Manna stays
     in-house.
  3. **Re-implement the published architecture and train it ourselves on short (5–15 s)
     clips, including gospel and worship music.** This is where training comes in, and it is
     expected to beat the borrowed model.

## Next steps
1. Record phone clips in church (sung, keyboard, full band), about 3 per song, and re-run.
   This is the go/no-go.
2. Test continuous listening: seconds until a confident, correct detection.
3. Add more references per song to the database, including full originals for the songs
   with data gaps.
4. Pick the licensing route for the embedding layer.
