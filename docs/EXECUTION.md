# Execution Log

## Session: 2026-04-12 / 2026-04-13

### Project Setup

- Explored upstream repo (`openbezal/rhema`) via GitHub API — 236 stars, MIT license, Tauri v2 + React 19 + Rust
- Cloned repo into `/Users/uxderrick-mac/Development/Manna` with fresh git history (no fork link)
- Installed Bun 1.3.12 and Rust 1.94.1
- Ran `bun install` (661 packages) and `bun run setup:all`
- Setup completed phases 1-4 (Bible data, translations, database) but failed at phase 5 (ONNX model export — OOM)
- Bible DB: 10 translations, 279,971 verses, 344,799 cross-references

### Brainstorming and Design

- Used `superpowers:brainstorming` skill to explore feature ideas
- Identified 10 Phase 1 features + 6 backlog items
- Chose Approach B (Infrastructure First) — 3 waves
- Explored comms360-v2 and complianceOS projects to document Design DNA
- Wrote and committed design spec: `docs/superpowers/specs/2026-04-12-manna-features-design.md`

### Wave 1 Implementation Plan

- Used `superpowers:writing-plans` to create 12-task plan
- Plan saved to: `docs/superpowers/plans/2026-04-12-wave-1-foundation.md`

### Wave 1A: Session Model (Subagent-Driven Development)

- **Task 1:** Installed `@phosphor-icons/react`, `react-resizable-panels`, `vaul`
- **Tasks 2-3:** Created Rust session types (`models.rs`, `error.rs`) and database layer (`db.rs`) in `rhema-notes` crate. Used `rusqlite 0.34` to match existing crate.
- **Task 4:** Created 13 Tauri session commands, wired `manna.db` with `dirs` crate
- **Tasks 5-6 (parallel):** Frontend types/store/hook + design DNA CSS tokens
- **Tasks 7-8-9 (parallel):** Menu bar, toolbar, panel tabs components
- **Task 10:** Workspace layout replacing old Dashboard
- **Task 11:** Integration tests — Rust compiles, TypeScript clean, 11/11 tests pass

### Wave 1B: Layout Debugging

- Initial white screen: `react-resizable-panels` v4 exports differ from v3 (`Group` not `PanelGroup`)
- Panel sizing broken: bare numbers in `defaultSize` don't work in v4 — needs CSS unit strings (`"22%"`)
- Used `superpowers:systematic-debugging` to trace through library source code and find root cause
- Fixed by using percentage strings for all panel size props
- Fixed panel overflow by removing card wrappers and adding `min-w-0`
- Fixed search panel responsiveness (stacked layout instead of horizontal)

### Wave 1C: UI Polish

- Used `superpowers:brainstorming` with visual companion to explore aesthetic directions
- Chose "Soft & Inviting" — warm cream/green palette, serif scripture text, pill tabs
- Brainstormed broadcast Preview/Program monitor layout (stacked, Option B)
- Wrote UI polish spec: `docs/superpowers/specs/2026-04-12-ui-polish-design.md`

**Implementation (10 tasks):**
- Warm OKLCH color tokens (light + dark mode)
- Pill-shaped tabs replacing underline tabs
- Panel header polish (bigger text, no dark-only shadow)
- Toolbar badge size fix
- Menu bar warmth (green "Manna" label)
- Detection cards (rounded-xl, serif verse text, pill buttons)
- Queue cards (compact, verse text preview, Go Live button)
- Broadcast monitor component (Preview + Program stacked)
- Workspace restructure (broadcast monitor always visible in right panel)
- Font-serif registration in `@theme` block

**Interaction refinements:**
- Preview flow: click verse → preview monitor → Go Live
- Prev/Next steps through verses in chapter (not queue)
- Preview auto-loads next verse when stepping while live
- Search panel auto-scrolls and syncs with Prev/Next
- "Live" indicator on active verse cards (red dot + "Live" text)
- First queue item auto-sends to preview
- Go Live button on verse cards (book search + context search)
- Visual distinction between Preview (blue tint) and On Screen (red tint when live)
- Buttons below text on selected verse (not hover icons on side)
- Context search cards match book search treatment
- Tooltips moved to top with pointer-events-none to avoid blocking clicks
- Plain language CTAs: Go Live, Clear, Add to Queue
- Smaller detection card buttons (xs size)

### Rebranding

- Updated `tauri.conf.json`: `productName`, `identifier`, window title from Rhema to Manna
- Updated `index.html` title

### Wave 1D: Semantic Detection Setup

**ONNX Model Research:**
- Original setup tried to export Qwen3-Embedding-0.6B from Python — OOM'd (needs ~10GB RAM)
- Researched 5 alternative models: MiniLM-L6-v2, BGE-small-en, E5-small, EmbeddingGemma-300M, Jina-v5-small
- Discovered pre-built ONNX files on HuggingFace for Qwen3 (onnx-community, zhiqing, electroglyph)

**Model downloads:**
- Downloaded onnx-community INT8 quantized (585MB) — had KV cache inputs, incompatible
- Downloaded zhiqing FP32 feature-extraction (1.1GB) — correct export, works but outputs FP16
- Downloaded MiniLM-L6-v2 ONNX (86MB) — pre-built, simple, fast
- Added `half` crate to handle FP16 model outputs in Rust

**Embedding precomputation:**
- Rust precompute binary: worked but too slow (600ms/verse = 5+ hours for 31K verses)
- Python ONNX Runtime: crashed on 1.1GB model load
- Python sentence-transformers with MPS GPU: succeeded for both models
  - MiniLM: 31,102 verses in ~5 minutes (384-dim, 46MB)
  - Qwen3: 31,102 verses in ~2.5 hours (1024-dim, 121MB) — ran in background and completed

**Final setup:**
- Both models available, Qwen3 prioritized at runtime (higher quality)
- Auto-detection: app picks best available model at startup
- Confidence threshold lowered to 0.40 for better paraphrase detection
- Detection cards show confidence percentage, ranked by confidence

### Speech Recognition

- Deepgram (cloud STT) already built into the app — works with API key
- Local Whisper also available as offline fallback
- Tested live transcription with Deepgram — direct detection works, semantic detection active with Qwen3

### Fixes During Testing

- Added native Edit menu (Undo/Redo/Cut/Copy/Paste/Select All) — Cmd+V wasn't working for API key input
- Fixed scroll on search panel (fragment → flex container, overflow-hidden → overflow-auto on PanelTabs)
- Sticky search controls (don't scroll with verse list)
- Mock detections added for UI testing (TODO: remove before production)

### Current State

- **Wave 1 complete** — app runs with full workspace UI, warm design, semantic detection
- Both MiniLM and Qwen3 embedding models available (Qwen3 active)
- Deepgram STT working for live transcription
- Ready for Wave 2 features

### Backlog Items Added

- Precompute semantic embeddings for all translations (currently KJV only)
- Upgrade to EmbeddingGemma-300M for multilingual + smaller size
- Cloud hosting (thin client + cloud hybrid)
- Remote control web UI redesign
