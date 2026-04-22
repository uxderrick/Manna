# Manna

Real-time AI-powered Bible verse detection for live sermons and broadcasts. A Tauri v2 desktop app with a React frontend and Rust backend.

Manna listens to a live sermon audio feed, transcribes speech in real time, detects Bible verse references (both explicit citations and quoted passages), and renders them as broadcast-ready overlays via NDI for live production.

> Manna is a friendly fork of [openbezal/rhema](https://github.com/openbezal/rhema), extended for church livestream workflows: multi-provider STT, sermon planner, live session management, AI summaries, and an API-key verifier.

---

## What Manna adds

> Built on [openbezal/rhema](https://github.com/openbezal/rhema) (core detection pipeline, NDI output, theme designer, Bible DB). Manna is a full UI redesign plus a church-livestream workflow and reliability layer.

<!-- screenshots: add before/after images here -->

### Redesigned UI

Rhema ships a fixed 4-column CSS grid with 6 hardcoded panels. Manna replaces this with:

- **Resizable panel workspace** (`react-resizable-panels`) with draggable dividers — 13 panel slots, switchable via a tabbed panel bar
- **Warm earth-tone OKLCH palette** — Manna shifts from rhema's green-lime primary (`oklch(0.53 0.16 131)` on pure white) to a warmer scheme (`oklch(0.45 0.1 155)` on warm off-white `oklch(0.965 0.008 75)`) with a full dark-mode overhaul
- **Motion system** — spring, smooth, and snap easing curves with duration tokens (`--ease-spring`, `--duration-fast`, etc.), not present upstream
- **10 dialogs / drawers** (upstream has 2) — welcome, about, announcement, resume session, end session, export notes, distribute summary, plus Vaul drawer primitives
- **Command palette** (cmdk) for keyboard-driven navigation
- **Native app menu** bridged to in-app actions

### Sermon workflow

- **Persistent sessions** — transcript, detections, notes saved per service (SQLite), resumable across restarts
- **Start Service** one-click flow with pre-flight checklist (mic / API key / network)
- **7 new panels:** sessions, session detail, notes, history, analytics, cross-reference, planner (merged into queue)
- **AI sermon summary** via Claude for export
- **Session export** — clipboard, markdown, JSON, print

### STT + reliability

- **AssemblyAI Universal-Streaming** as a second provider, alongside Deepgram + Whisper
- **One-click API-key verifier** — HTTP auth probe + WebSocket handshake, inline ✓ / ✗
- **Shared WebSocket runtime** — Deepgram + AssemblyAI share one connect/reconnect loop
- **Proper reconnect semantics** — `stt_reconnecting` vs `stt_disconnected` so transient drops don't tear down the UI

**→ [Full feature comparison with file pointers](docs/wiki/Manna-vs-Rhema.md)**

---

## Tech Stack

| Layer | Technologies |
|---|---|
| **Frontend** | React 19, TypeScript, Tailwind CSS v4, shadcn/ui, Zustand, Vite 7 |
| **Backend** | Tauri v2, Rust (workspace with 7 crates) |
| **AI / ML** | ONNX Runtime (Qwen3-0.6B embeddings), Aho-Corasick, Fuse.js, Anthropic Claude (summaries) |
| **Database** | SQLite via rusqlite (bundled) with FTS5 |
| **Broadcast** | NDI 6 SDK via dynamic loading (libloading FFI) |
| **STT** | Deepgram + AssemblyAI (WebSocket via tokio-tungstenite, shared ws_runtime), Whisper (local, `ggml-large-v3-turbo`) |

### Rust crates

| Crate | Purpose |
|---|---|
| `rhema-audio` | Audio device enumeration, capture, VAD (cpal) |
| `rhema-stt` | STT providers (Deepgram, AssemblyAI, Whisper) + shared WebSocket runtime |
| `rhema-bible` | SQLite Bible DB, FTS5 search, cross-references |
| `rhema-detection` | Verse detection pipeline: direct, semantic, quotation, ensemble merger, sentence buffer, sermon context, reading mode |
| `rhema-broadcast` | NDI video frame output via FFI |
| `rhema-api` | Tauri command API layer |
| `rhema-notes` | Session notes + sermon-notes types |

> Crate names still carry the `rhema-` prefix upstream; the app's package name and bundle identifier are `manna`.

---

## Prerequisites

- [Bun](https://bun.sh/) — runtime for scripts + package manager
- [Rust](https://rustup.rs/) toolchain (stable, 1.77.2+)
- [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) — platform-specific system deps
- [Python 3.11+](https://www.python.org/) — managed automatically by Phase 1 of any setup recipe
- **One STT provider**:
  - [Deepgram API key](https://deepgram.com/) — Nova-3, keyword boosting
  - [AssemblyAI API key](https://assemblyai.com/) — Universal-Streaming v3, cheaper ($0.15 / hr), strong proper-noun accuracy
  - Or Whisper (no key, runs locally — `bun run setup:whisper`)
- [Anthropic API key](https://console.anthropic.com/) — optional, powers the AI sermon summary

### Resource requirements

- **Disk:** 2 GB minimal, 6 GB full (Qwen3 ONNX + KJV embeddings + Whisper model)
- **Network:** ~2 GB download minimal, ~4 GB full
- **GPU:** required only for `setup:semantic`. Auto-detected (MPS on Mac, CUDA on Linux). CPU fallback requires explicit `FORCE_CPU=1` — takes 10+ hours for KJV precompute.

---

## Getting Started

```bash
git clone https://github.com/<your-fork>/manna.git
cd manna
bun install
```

### Which setup do I need?

| Scenario | Recipe | Time | Disk |
|----------|--------|------|------|
| Church PC (no GPU) | `bun run setup:minimal` | ~10 min | 2 GB |
| Mac M1/M2/M3 (MPS) | `bun run setup:all` | ~45 min | 6 GB |
| Linux + NVIDIA | `bun run setup:all` | ~30 min | 6 GB |
| CI / quick dev check | `bun run setup:minimal` | ~10 min | 2 GB |

### What each setup gives you

| Feature | minimal | + semantic | + whisper |
|---------|---------|-----------|-----------|
| Bible lookup (search, nav) | ✓ | ✓ | ✓ |
| Direct reference detection ("John 3:16") | ✓ | ✓ | ✓ |
| Quotation detection (exact KJV wording) | ✓ | ✓ | ✓ |
| Semantic detection (paraphrase, loose quotes) | — | ✓ | ✓ |
| Cloud STT (Deepgram, AssemblyAI) | ✓ | ✓ | ✓ |
| Local Whisper STT (offline, free) | — | — | ✓ |

### Minimal install (~10 min)

```bash
bun run setup:minimal
bun run tauri dev
```

App is fully functional — direct + quotation verse detection active. For semantic detection or local Whisper STT, run the optional upgrades below.

### Optional: semantic detection (~30–45 min on GPU)

Adds Qwen3 ONNX precompute for paraphrase detection. **Requires GPU** — pre-flight check aborts on CPU.

```bash
bun run setup:semantic
# CPU fallback (not recommended, 10+ hours):
FORCE_CPU=1 bun run setup:semantic
```

### Optional: local Whisper STT (~3 min, 1 GB)

Downloads Whisper model for offline transcription. Alternative to cloud STT keys.

```bash
bun run setup:whisper
```

### Full setup (all phases)

Runs minimal + semantic + whisper + copyrighted BibleGateway translations in one go.

```bash
bun run setup:all
bun run setup:all --force   # re-run even if artifacts exist
```

### Environment

Create a `.env` file in the project root:

```
DEEPGRAM_API_KEY=your_key_here
ASSEMBLYAI_API_KEY=your_key_here
ANTHROPIC_API_KEY=your_key_here     # optional, for AI summaries
```

Keys can also be entered in **Settings → Speech** inside the app and verified with the **Test** button.

### NDI SDK (optional)

For broadcast output via NDI:

```bash
bun run download:ndi-sdk
```

### Run in development

```bash
bun run tauri dev
```

### Build for production

```bash
bun run tauri build
```

### Advanced: running individual phases

The orchestrator accepts a `--phases=<csv>` flag. Valid phase ids:

| Phase | id | What it does |
|-------|----|---|
| 1 | `venv` | Python `.venv` + pip deps |
| 2 | `bible-data` | Download scrollmapper + cross-refs |
| 3 | `biblegateway` | Download copyrighted translations (NIV, ESV, etc.) |
| 4 | `build-db` | Build `data/rhema.db` (SQLite + FTS5) |
| 5 | `onnx` | Download + quantize Qwen3 ONNX model |
| 6 | `export-verses` | Export KJV verses → JSON |
| 7 | `precompute` | Compute KJV embeddings (GPU required) |
| 8 | `whisper` | Download Whisper STT model |

```bash
bun run setup:all --phases=venv,bible-data,build-db
bun run setup:all --phases=biblegateway   # add NIV/ESV/etc. later
bun run setup:all --force                 # bypass artifact idempotency
```

Individual legacy scripts (`download:bible-data`, `build:bible`, `download:model`, `export:verses`, `download:whisper`) still work if you prefer running them directly.

---

## Using Manna

### Before the service

1. **Settings → Speech** — pick a provider, paste the key, click **Test**. Green check = HTTP auth passed and the streaming WebSocket handshake succeeded. If you see red, the detail message tells you why (invalid key, network, rate-limited, etc.).
2. **Settings → Audio** — pick the input device and check the gain meter.
3. **Settings → Bible** — set the active translation.
4. **Settings → Display Mode** — choose manual vs auto-broadcast, set the confidence threshold and cooldown.

### During the service

1. Click **Start Service**. The pre-flight checklist runs:
   - ✓ Audio device available
   - ✓ Selected provider API key configured
   - ✓ Network reachable
2. Transcription starts and the detection pipeline emits verses as they're mentioned.
3. **Auto mode** broadcasts the top-confidence verse automatically (respecting the cooldown). **Manual mode** shows candidates; you click a verse or use the Queue to go live.
4. The **Queue** doubles as a sermon planner — search, reorder, and load verses ahead of time, or build it on the fly.
5. Verses that cross the 99% threshold are auto-added to the **History** tab.

### After the service

- **Export** — clipboard / markdown / JSON / print from the session panel.
- **AI summary** — Claude summarises the transcript (short-transcript and API-overload fallbacks included).

---

## Project Structure

```
manna/
├── src/                          # React frontend
│   ├── components/
│   │   ├── broadcast/            # Theme designer, NDI settings, broadcast monitor
│   │   ├── controls/             # Transport bar
│   │   ├── layout/               # Dashboard layout
│   │   ├── panels/               # Transcript, preview, live output, queue, search, detections, sessions, notes
│   │   ├── settings-dialog.tsx   # Settings UI (Speech, Audio, Bible, Display, API keys, Remote)
│   │   ├── preflight-checklist.tsx
│   │   └── ui/                   # shadcn/ui + custom components
│   ├── hooks/                    # useAudio, useTranscription, useDetection, useBible, useBroadcast
│   ├── stores/                   # Zustand stores (audio, transcript, bible, queue, detection, broadcast, settings, session)
│   ├── types/                    # TypeScript type definitions
│   └── lib/                      # Context search (Fuse.js), verse renderer (Canvas 2D), builtin themes
├── src-tauri/                    # Rust backend (Tauri v2)
│   ├── crates/
│   │   ├── audio/                # Audio capture & metering (cpal)
│   │   ├── stt/                  # STT providers
│   │   │   ├── deepgram.rs       # Deepgram Nova-3 streaming
│   │   │   ├── assemblyai.rs     # AssemblyAI Universal-Streaming v3
│   │   │   ├── whisper.rs        # Local Whisper (optional feature)
│   │   │   ├── ws_runtime.rs     # Shared WebSocket connect/reconnect loop
│   │   │   └── keyterms.rs       # Bible keyterm lists for prompt boosting
│   │   ├── bible/                # SQLite Bible DB, search, cross-references
│   │   ├── detection/            # Verse detection pipeline
│   │   │   ├── direct/           # Aho-Corasick + fuzzy reference parsing
│   │   │   ├── semantic/         # ONNX embeddings, HNSW index, cloud booster, ensemble
│   │   │   └── reading_mode.rs   # Reading vs referencing classifier
│   │   ├── broadcast/            # NDI output (FFI)
│   │   ├── api/                  # Tauri command API
│   │   └── notes/                # Session + sermon note types
│   ├── src/commands/             # Tauri command handlers
│   └── tauri.conf.json
├── data/                         # Bible data pipeline
│   ├── prepare-embeddings.ts     # Unified setup orchestrator (bun run setup:all)
│   ├── lib/python-env.ts         # Shared Python venv management utilities
│   ├── download-sources.ts       # Download public domain translations + cross-refs
│   ├── download-biblegateway.py  # Download copyrighted translations (NIV, ESV, etc.)
│   ├── build-bible-db.ts         # Build SQLite DB from JSON sources
│   ├── compute-embeddings.ts     # Export verses to JSON for embedding
│   ├── precompute-embeddings.py  # Precompute embeddings (GPU auto-detect, ONNX fallback)
│   ├── download-model.ts         # Export & quantize Qwen3 ONNX model
│   ├── download-ndi-sdk.ts       # Download NDI SDK libraries
│   └── schema.sql                # Database schema
├── models/                       # ML models (gitignored)
├── embeddings/                   # Precomputed vectors (gitignored)
├── sdk/ndi/                      # NDI SDK files (downloaded)
└── build/                        # Vite build output
```

---

## Scripts

| Script | Description |
|---|---|
| `setup:minimal` | **Recommended first run** — Python venv + Bible data + DB + verse export (~10 min, no GPU) |
| `setup:semantic` | Add ONNX model + KJV embedding precompute (~30–45 min, GPU required) |
| `setup:whisper` | Add offline Whisper STT model (~3 min, 1 GB) |
| `setup:all` | **Full setup** — all 8 phases (idempotent) |
| `dev` | Start Vite dev server (port 3000) |
| `tauri` | Run Tauri CLI commands (`bun run tauri dev` / `bun run tauri build`) |
| `build` | TypeScript check + Vite production build |
| `test` | Run Vitest tests |
| `lint` | ESLint |
| `format` | Prettier formatting |
| `typecheck` | TypeScript type checking |
| `preview` | Preview production build |
| `download:bible-data` | Download public domain Bible translations + cross-references |
| `build:bible` | Build SQLite Bible database from JSON sources |
| `download:model` | Export Qwen3-Embedding-0.6B to ONNX + quantize to INT8 |
| `export:verses` | Export KJV verses to JSON for embedding precomputation |
| `precompute:embeddings` | Precompute embeddings via Rust ONNX binary |
| `precompute:embeddings-onnx` | Precompute embeddings via Python ONNX Runtime |
| `precompute:embeddings-py` | Precompute embeddings via Python sentence-transformers |
| `quantize:model` | Quantize ONNX model to INT8 for ARM64 |
| `download:ndi-sdk` | Download NDI 6 SDK headers and platform libraries |

---

## Environment Variables

Create a `.env` file in the project root:

| Variable | Required | Description |
|---|---|---|
| `DEEPGRAM_API_KEY` | One required (or Whisper) | Deepgram speech-to-text |
| `ASSEMBLYAI_API_KEY` | One required (or Whisper) | AssemblyAI speech-to-text |
| `ANTHROPIC_API_KEY` | Optional | Enables the AI sermon summary on export |

Keys pasted into **Settings → Speech** are persisted via `tauri-plugin-store` and override the `.env` values.

---

## Tauri commands (selected)

| Command | Purpose |
|---|---|
| `start_transcription` / `stop_transcription` | Audio → STT → detection pipeline lifecycle |
| `verify_deepgram_key` / `verify_assemblyai_key` | HTTP auth + WebSocket handshake probe for the given key |
| `detect_verses` / `semantic_search` / `quotation_search` | Detection pipeline entry points |
| `reading_mode_status` / `stop_reading_mode` | Reading-mode classifier controls |
| `create_session` / `start_session` / `end_session` / `list_sessions` | Session lifecycle |
| `update_session_title` / `update_session_summary` | Session metadata |
| `add_session_detection` / `add_session_transcript` / `add_session_note` | Session persistence |
| `ensure_broadcast_window` / `open_broadcast_window` / `close_broadcast_window` | Broadcast output window |
| `start_ndi` / `stop_ndi` / `get_ndi_status` / `push_ndi_frame` | NDI output |
| `start_osc` / `start_http` / `update_remote_status` | Remote control (OSC + HTTP) |
| `list_custom_themes` / `save_custom_theme` / `delete_custom_theme` | Theme designer persistence |

---

## Contributing

Issues and pull requests welcome. This is a personal fork tested against a live church livestream workflow; changes that help other churches ship on Sunday are especially appreciated.

## License

See [LICENSE](LICENSE). Upstream attribution: [openbezal/rhema](https://github.com/openbezal/rhema).
