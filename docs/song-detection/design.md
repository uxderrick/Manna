# Song Detection by Sound ("Song Keys"): Design

Status: Stage 2 (offline prototype). First benchmark done; see [results.md](./results.md). Data: [data-plan.md](./data-plan.md). Code: [research/song-detection](../../research/song-detection/).

## Goal
Manna already detects Bible verses in the pastor's speech. This feature detects **which song is being performed** from the **sound alone**, with no lyric matching, and projects that song's lyrics.

- It works whoever is producing the sound: the choir singing, the keyboard playing the intro, or the full band.
- It tells apart different songs with the same title, e.g. "The Lord's Prayer" by Bethel vs by Hillsong.
- Each song is pre-encoded as **song keys** derived from what never changes between performances. Keys come from many renditions and are linked to the lyrics in the `songs` table.
- The service plan gives planned songs a head start. Songs the choir switches to off-plan are still caught, and a guest minister's songs can be prepared ahead from a file or link.

## Music-school foundation: what stays the same vs what changes

| Element | Same every performance? | Who carries it | Use |
|---|---|---|---|
| **Melody**: scale-degree steps (do→fa = +5) | Yes, the song's identity | Singer, keyboard intro, lead guitar | **Primary key** |
| **Melodic rhythm**: relative note lengths | Yes (ratios only) | Singer, lead instrument | Part of the melody key |
| **Harmony**: chord progression as Roman numerals (I–IV–V–vi, not G–C–D–Em) | Mostly; some re-harmonisation | Keyboard, guitar, bass | **Secondary key**, works with no one singing |
| **Harmonic rhythm**: how long each chord lasts, in bars | Mostly | Band | Part of the harmony key |
| **Meter**: 3/4, 4/4 or 6/8 | Yes | Drums, everyone | Filter (halves the candidates) |
| **Form**: verse, chorus and bridge order and lengths | Partly (leaders repeat choruses) | Everyone | Where we are in the song, not identity |
| Key (G vs A) | No (transposed for the choir) | n/a | Ignore by normalising |
| Tempo | No | n/a | Ignore by using ratios |
| Timbre, voice, instrument | No, this identifies the **performer**, not the song | n/a | Ignore |

Design rules that follow from this:
1. **Encode the melody, not the chord progression alone.** Thousands of songs share I–V–vi–IV.
2. **Store intervals, not notes.** do→fa = +5 in any key, so the key stops mattering.
3. **Store duration ratios, not seconds.** Tempo stops mattering.
4. **Use many short hashes, not one long sequence.** Ad-libs and wrong notes then only lose a few votes. This is the Shazam technique, applied to pitch steps instead of spectral peaks.
5. **Use several renditions per song**, to cover local arrangements.

### Worked examples
- **The Lord's Prayer, Bethel vs Hillsong:** different compositions, so different melodies and progressions. They get separate `song_id`s with separate lyrics, and the keys separate them easily.
- **Way Maker, Sinach vs Leeland:** the same composition. One `song_id`, and both renditions add keys to it.
- **One hymn text sung to two different tunes:** the words are identical, but only the melody tells which tune it is. Here sound beats lyrics.

## Three layers of keys

### 1. Melody keys (voice or any lead instrument)
```
audio ─► pitch track (f0) ─► note segmentation
      ─► intervals [+5,+2,+5,-12…] + duration ratios
      ─► rolling hashes h(i1..i4, d1..d3), each stored with offset t
```
- **Live matching:** look up each hash and vote by `(song_id, rendition, Δt = t_db − t_live)`. A consistent Δt cluster is a match. The time-offset check rejects random collisions.
- **Position comes free:** the matched `t` tells verse vs chorus melody and which line is being sung.
- **Limit:** verse 1 and verse 3 share a melody. Resolve it by counting passes through the verse melody, with an operator override.
- **Optional rerank:** subsequence DTW on the top 5 candidates.

### 2. Harmony keys (band, even with no singer)
- Chroma features (12 pitch classes, octaves folded together) don't depend on the instrument: a C chord on piano or guitar gives the same chroma.
- Estimate the key, then convert chords to Roman numerals and harmonic rhythm. Hash chord-change n-grams with offset, the same as the melody keys.
- Weak alone (many shared progressions) but strong when combined with melody and meter.

### 3. Whole-song embedding (catch-all)
- A pretrained **cover-song identification** model (CQT input; CoverHunter / ByteCover family, exported to ONNX) learns "same song, different key, tempo, singer or band."
- Prototype finding: this layer is the main one, not a catch-all. On its own it reaches 76% top-1 and 92% top-3 at 10 s with a service plan, against about 50% without AI. CoverHunter has no licence, so it is a benchmark only; see the licensing decision in [results.md](./results.md).
- Each rendition becomes a vector, and the live 10–15 s window is compared by cosine search.
- Reuse the brute-force cosine index in `src-tauri/crates/detection/src/semantic/hnsw_index.rs`.

### Fusion
`score = w_m·melody + w_h·harmony + w_e·embedding`, then a **meter filter**, a **service-plan prior** and recency/cooldown. Model this on `src-tauri/crates/detection/src/merger.rs`.

| What's playing | Signals available |
|---|---|
| Keyboard intro | Harmony + melody + embedding |
| A cappella choir | Melody + embedding |
| Full band | All three |

The full DB is always searched. The plan only boosts, so off-plan songs are still caught.

## Pipeline

### A. Ingest (builds the key DB, offline or in-app "prepare ahead")
- **Sources:** sheet music / MIDI / MusicXML (exact melody and chords, no audio processing needed), and audio renditions. See [data-plan.md](./data-plan.md).
- **Audio path:** stem separation (Demucs: vocals / other / bass), then:
  - vocals → melody keys
  - other + bass → chroma → harmony keys
  - full mix → embedding
- Several renditions per song, all under one `song_id`.
- **"Prepare ahead" UI** in the song editor: add a source (file or link), the job runs, and a key-count badge shows.

### B. Live matcher (Rust, inside Manna)
- A new consumer on the 16 kHz `audio-fanout` thread (`src-tauri/src/commands/stt/capture.rs:77-251`), using a crossbeam channel like STT.
- **Music/speech gate:** VAD (`src-tauri/crates/audio/src/vad.rs`) plus pitch stability and harmonicity. While music is playing, verse detection is suppressed so lyrics don't trigger verses.
- Per window, in parallel:
  - pitch (CREPE-tiny ONNX via existing `ort`, or the `pitch-detection` crate) → melody hashes
  - chroma → harmony hashes
  - CQT → embedding
- Fusion emits `song_detections { song_id, section, line_idx, pass, confidence, signals }`.
- Proposed modules: `crates/detection/src/melody/`, `harmony/`, `song_embed/`, `song_fusion.rs`. Glue in `src-tauri/src/commands/stt/song.rs`.

### C. Storage (`manna.db`, `src-tauri/crates/notes/src/db.rs`)
- `song_renditions(id, song_id, source, source_ref, key_detected, tempo, meter, created_at)`
- `song_melody_hashes(hash, rendition_id, t_ms, section)`, indexed on hash
- `song_harmony_hashes(hash, rendition_id, t_ms, section)`, indexed on hash
- `song_embeddings(rendition_id, window_t_ms, vec BLOB)`
- Lyrics stay in `songs.data` (stanzas and chorus).

### D. Frontend
- `src/components/panels/transcript-panel.tsx` listens for `song_detections`, like `verse_detections`.
- Auto mode queues a `song-stanza` (`src/stores/queue-store.ts:223`) and calls `goLive`, then advances lines as `line_idx` moves.
- Operator chip: "Detected: Lord's Prayer (Bethel), 92%", with the top 3 alternatives one click away.

## Phases
1. **Data collection:** online/reference sources plus the user's own recordings. See [data-plan.md](./data-plan.md).
2. **Python prototype (offline):** take a 20-song seed set and test each layer alone and fused, under three conditions: voice only, keyboard only, full band. Report top-1 accuracy and seconds-to-detect. This is the go/no-go point and picks the weights.
3. **Rust live matcher:** gate, the layers that won the prototype, fusion, the `song_detections` event and auto-present.
4. **Ingest tool:** sheet-music/MIDI import for hymnals, the audio path, and the "prepare ahead" UI.
5. **Position tracking:** section and line advance, stanza pass counting.
6. **Self-learning:** confirmed songs save that session's audio as a new rendition, once Manna session recordings exist.

## Risks
- **SATB harmony and a loud band blur the melody.** The harmony and embedding layers cover it, and the melody layer uses a confidence floor.
- **Generic progressions and praise breaks.** Use the meter filter and the plan prior, and the operator picks from the top 3.
- **CPU: three models live.** Run them only while music is playing, and run the embedding every 5 s.
- **Licensing:** check the embedding model's license and that it exports to ONNX. Check the licenses of the data sources too (see the data plan).
- **Latency target:** a match within about 6–10 s of singing or playing.
