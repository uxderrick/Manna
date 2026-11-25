# Song Detection: Training & Test Data Plan

Status: Stage 1. Collect data before writing code. Design: [design.md](./design.md).

## Data we need

| Kind | Purpose | Per song |
|---|---|---|
| **Reference** | Build the song keys | Melody (notes) + chords + 2–3 audio renditions |
| **Query / test** | Simulate the live church | Short clips: voice only, keyboard only, full band, in different keys and tempos |
| **Model weights** | Embedding layer | Pretrained cover-song model, so we don't train from scratch |

## Sources (checked 2026-10)

| Source | Gives | Access | Verdict |
|---|---|---|---|
| [Hymnary.org](https://hymnary.org) | MusicXML + MIDI per hymn tune (exact melody and harmony). It already runs a melody search over about 2,800 tunes, which proves the idea works. | Free and open access. No public API found: hymn → tune page → download. | **Use** for GHS/SDA hymns. Our bundled `src-tauri/hymnals/*.json` have an empty `tune` field (GHS has 260 hymns, SDA 695; MHB and Sankey are empty), so match by title or first line. |
| CCLI SongSelect | Lead sheets (melody) + chord charts for Bethel, Hillsong, etc. | Needs the church's CCLI subscription | **Best** source for contemporary worship if the church is licensed |
| Worship Together / publisher chord charts | Chords aligned with lyrics | Free PDFs for many songs | Harmony keys and section map |
| MuseScore community scores | MusicXML melodies | Free account; the license varies per score | Fallback |
| Purchased downloads (iTunes, Amazon, Bandcamp) | Real audio renditions | Bought by the user | Clean for personal R&D |
| Spotify | Song lists and metadata (playlists, artists, ISRC) | Web API. **No audio:** `preview_url` and audio-analysis/features are deprecated or revoked for new dev apps (reported Nov 2024), and the ToS forbids ripping or recording. Spotify CLIs (e.g. `spotify_player`) only control playback. | Use **only to build the seed song list** from a church playlist |
| YouTube live versions | Many real live renditions, the closest to church conditions | `yt-dlp` works technically, but the **ToS forbids downloading**. | **User's decision.** If used: local R&D only, never shipped or committed; keep only derived keys/embeddings. |
| User's own recordings | Query/test set with controlled key and tempo | Phone voice memos + keyboard | **Essential:** the best test of key and tempo invariance |
| [CoverHunter](https://github.com/liu-feng-deeplearning/coverhunter) (weights mirrored on [Hugging Face](https://huggingface.co/userx1/CoverHunter), OpenRAIL) | Embedding layer | Download the weights, then check the license allows commercial use | **Try first** |
| [ByteCover](https://arxiv.org/abs/2010.14022) (Orfium/bytecover code) | Embedding layer (alternative) | Check whether the weights are available | Fallback |
| SHS100K / Da-TACOS / DiscogsVI | Fine-tuning later, if needed | Research datasets (YouTube IDs or precomputed features) | Not needed for Stage 1 |

## Seed set
The concrete download list (20 pairs built around Maverick City, Hillsong, Bethel and Elevation) is in [seed-songs.md](./seed-songs.md).

## Recording protocol (user, phone is fine, about 1–2 min per clip)
For each song, record:
1. Verse + chorus sung in the **original key**
2. The same, sung **+2 to +5 semitones** higher (e.g. G → A or C)
3. **Hummed** (no words)
4. **Keyboard melody only** (right hand)
5. **Keyboard chords only** (left hand / pads)
6. Optional: one slower and one faster version

File name: `<song_slug>__<type>__<key>__<bpm>.m4a`, e.g. `lords-prayer-bethel__voice__A__72.m4a`.
`type` is one of `voice`, `hum`, `keys-melody`, `keys-chords`, `band`.

## Folder layout
Kept outside the repo. Audio is never committed.
```
~/manna-song-data/
  manifest.csv
  reference/scores/      # .musicxml / .mid
  reference/chords/      # chord charts (.pdf / .txt)
  reference/audio/       # purchased / chosen renditions
  queries/voice/
  queries/keys/
  queries/band/
  models/                # cover-song model weights
```

`manifest.csv` columns:
```
song_slug,title,composer,artist,source_type,path,key,bpm,meter,license,notes
```
`source_type` is one of `score`, `chords`, `audio-ref`, `query-voice`, `query-hum`, `query-keys-melody`, `query-keys-chords`, `query-band`.

## Done when
- [ ] The manifest lists 20 songs.
- [ ] Each song has at least 1 melody source (score or audio) and at least 4 query clips.
- [ ] The embedding model weights are downloaded and the license is noted.
- [ ] Open decisions are answered: CCLI license available? YouTube yes/no?

Then **Stage 2** starts: a Python prototype that tests each layer per condition (voice / keys / band) and the fused result. See [design.md](./design.md#phases).
