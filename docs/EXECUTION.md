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
- **Ship DMG/EXE releases** via GitHub Actions — bundle rhema.db inside app, prompt for API key on first launch, make ONNX semantic search optional
- **Simplify setup docs** — add clear timeline/bandwidth expectations, GPU detection warning, "minimal setup" path that skips ONNX + embeddings precompute
- **Songs tab** — Wave 2 feature, still placeholder (ghs.json hymns data already bundled in src-tauri/)
- **Planner tab** — not yet scoped

## Session: 2026-04-14 — Voice Commands, Broadcast Sync, STT Reliability

### Voice Verse Navigation (Ordinals)

- Generalized `extract_verse_number` in [reading_mode.rs](src-tauri/crates/detection/src/reading_mode.rs) to handle arbitrary ordinals before "verse".
- Supports: spoken 1–20 ("first"…"twentieth"), hyphenated compounds ("twenty-first"), two-word compounds ("twenty first verse"), digit-suffix ("21st", "100th").
- Calls `parse_ordinal` and `parse_tens` helpers.

### Translation Real-time Sync to TV/Broadcast

- Problem: changing translation (via voice, search-panel selector, settings dialog, or broadcast-monitor toggle) updated the Bible store but NOT the live/preview verse on the TV/broadcast output. Only changing scripture re-fetched verse text.
- Fix: extracted `retranslateBroadcastVerses(translationId, abbreviation)` helper in [use-broadcast.ts](src/hooks/use-broadcast.ts). Re-fetches current live + preview verses in the new translation via `invoke("get_verse", ...)` and calls `setLiveVerse` / `setPreviewVerse` to trigger the store's sync-to-broadcast emit.
- Wired into all four translation-switch call sites: broadcast-monitor toggle, search-panel select (2 occurrences), settings-dialog select, and the voice command listener in transcript-panel.

### Broadcast Event Sync (Tauri `emitTo` → `emit`)

- Problem: even after re-fetch was wired, broadcast window still lagged — changes worked a few times then stopped. Root cause: Tauri v2's `emitTo(label, ...)` has known reliability bugs under rapid updates ([#11379](https://github.com/tauri-apps/tauri/issues/11379)).
- Fix: switched from `emitTo("broadcast", "broadcast:verse-update", ...)` to plain `emit("broadcast:verse-update:${outputId}", ...)` with output-id in the event name. Updated listener in [broadcast-output.tsx](src/broadcast-output.tsx) and the test fixture.

### Deepgram Keyterm Audit

- Problem: "Peter" transcribed as "beta". Keyterm list only had "1 Peter" / "2 Peter" / "First Peter" — Deepgram keyterm boosting doesn't substring-match.
- Fix: added bare proper names (Peter, Paul, Moses, David, etc.) and translation abbreviations (NIV, ESV, …) at the top of `bible_keyterms()` in [keyterms.rs](src-tauri/crates/stt/src/keyterms.rs), before the 100-term cap in [deepgram.rs](src-tauri/crates/stt/src/deepgram.rs) can evict them.
- Removed incorrect `:3` intensifier suffixes — Nova-3 Keyterm Prompting doesn't support them (that's Keywords-only).

### STT Reliability — "Session ends abruptly"

Systematic-debugging skill invoked. Symptoms: UI flipped to empty state during live transcription; clicking Start again returned "Transcription is already running."

Root causes (two stacked bugs):

1. **Frontend killed its own UI on every Deepgram reconnect.** Deepgram silence-closes fire `stt_disconnected`, but the backend auto-reconnects. Frontend treated every `stt_disconnected` as terminal, flipping `isTranscribing=false`. Empty state renders when `detections.length === 0 && !isTranscribing`.

2. **`start_transcription` rejected with "already running"** because `stt_active=true` in the backend even while the UI looked ended.

Fixes:

- [transcript-panel.tsx](src/components/panels/transcript-panel.tsx): `stt_disconnected` no longer flips `isTranscribing=false` — only `stt_error` does (truly terminal). `stt_connected` re-asserts `isTranscribing=true` on reconnect.
- [stt.rs](src-tauri/src/commands/stt.rs): `start_transcription` is now idempotent — if already running, re-emit `stt_connected` and return Ok instead of erroring.
- [deepgram.rs](src-tauri/crates/stt/src/deepgram.rs): reconnect loop detects when the audio source is dropped (via `audio_rx.try_recv()` returning `TryRecvError::Disconnected`) and exits cleanly instead of reconnecting into a dead channel.

### Open Items / Future Work

- [ ] Store `SttProvider` handle in `AppState` so `stop_transcription` can call `provider.stop()` directly (currently relies on audio channel drop to indirectly cancel Deepgram).
- [ ] Convert remaining `emitTo` calls in [broadcast-settings.tsx](src/components/broadcast/broadcast-settings.tsx) (NDI config) to plain `emit` with output-scoped event names for consistency.
- [ ] Add integration test covering the Deepgram silence-close → reconnect → UI-stays-live scenario.
- [ ] End-to-end verify: cold-start the app, start a session, speak continuously for 30+ seconds, stop speaking for 15+ seconds (forcing a silence-close reconnect), resume speaking, verify detections still flow and UI never shows empty state.

## Session: 2026-04-15 — AssemblyAI STT Provider

- Added AssemblyAI Universal-Streaming as third STT provider alongside Deepgram and Whisper.
- Implementation: new `AssemblyAIClient` in `rhema-stt` crate, mirrors `DeepgramClient` structure for reconnect semantics.
- Event shape: translates `Turn` messages to existing `TranscriptEvent::Partial` / `Final`, so detection pipeline and frontend are unchanged.
- Keyterms: reuses existing `bible_keyterms()` list via AssemblyAI's `keyterms_prompt` query param.
- Settings: new `assemblyAiApiKey` field in Zustand store, hydrated + persisted via Tauri plugin-store.
- Keepalive: sends `{"type": "KeepAlive"}` every 5s during silence to prevent idle close (matches Deepgram pattern).
- Duplicate-event fix: `parse_and_send` returns `Result<bool, SttError>` where `Termination` returns `Ok(true)` to break the receiver loop — outer loop emits the single `Disconnected` event.
- Call-site key selection: toolbar + resume-session-dialog pick between `deepgramApiKey` / `assemblyAiApiKey` based on `settings.sttProvider`.
- Verified: `cargo check` clean, TypeScript clean, 11/11 vitest pass.

Spec: `docs/superpowers/specs/2026-04-15-assemblyai-provider-design.md`
Plan: `docs/superpowers/plans/2026-04-15-assemblyai-provider.md`

## Session: 2026-04-19 — Transcription Start/Stop Fixes

User report: "transcription not working." Logs showed AssemblyAI `Turn` events arriving 100–300 ms after `Transcription stop requested`, consumer task exiting before forwarding them — late transcripts dropped on every short test session. Separate: first-time WS upgrade took 10–21 s on cold TLS/DNS, with UI showing "End Service" immediately after `invoke` returned (before `stt_connected`), so users stopped mid-connect.

### Fixes

- **Consumer drop-on-stop** ([src-tauri/src/commands/stt.rs:295](src-tauri/src/commands/stt.rs#L295)): removed early `break` on `evt_active` check inside the event loop. Loop now drains until provider task drops the sender, so Turn/Final events that arrive after the stop flag flips still reach the frontend.
- **Premature "End Service" button state** ([src/components/layout/toolbar.tsx:101](src/components/layout/toolbar.tsx#L101), [src/components/resume-session-dialog.tsx:58](src/components/resume-session-dialog.tsx#L58)): removed local `setTranscribing(true)` after `invoke("start_transcription")`. Backend `stt_connected` event is now the single source of truth — button stays "Connecting…" (disabled) until WS upgrade completes.
- **AssemblyAI key verify network error** ([src-tauri/src/commands/stt.rs:928-951](src-tauri/src/commands/stt.rs#L928)): `http_probe` was failing with opaque `network: error sending request` on cold start. Bumped `PROBE_TIMEOUT` 6s → 15s, added explicit 10s `connect_timeout`, forced `http1_only()` (sidestep reqwest rustls HTTP/2 cold-start issues), and walked the error `source()` chain so the UI shows the root cause.
- **Env var loading** ([src-tauri/src/lib.rs:17-20](src-tauri/src/lib.rs#L17)): `dotenvy` was loading `.env` / `src-tauri/.env` but not `.env.local`. Added `from_filename("../.env.local")` so local dev keys are picked up.

### Follow-ups from this session

- [x] Store `SttProvider` handle in `AppState` so `stop_transcription` can call `provider.stop()` directly — done later this session.
- [x] "Connecting…" badge needs a visible progress indicator — `Loader2Icon` spinner added, tooltip hint for cold-start wait.
- [x] Warming the reqwest/rustls connection pool at app startup — done later this session.

## Session: 2026-04-19 (cont) — Tech Debt Sweep

Cleared 6 tech-debt items in one pass. All compile clean, vitest 16/16 pass.

### 1. `emitTo` → scoped `emit` in broadcast-settings.tsx

- [broadcast-settings.tsx](src/components/broadcast/broadcast-settings.tsx): replaced three `emitTo(label, "broadcast:ndi-config", ...)` call sites with `emit("broadcast:ndi-config:${outputId}", ...)`.
- [broadcast-output.tsx](src/broadcast-output.tsx): listener now subscribes to the scoped event name matching its `OUTPUT_ID`.
- Removes exposure to Tauri v2 `emitTo` reliability bugs (learning #19) for the NDI config path. `broadcast:output-ready` stays on `emitTo` — low volume, different direction (broadcast → main).

### 2. Connection pool warmup at startup

- [lib.rs](src-tauri/src/lib.rs): new `warm_connection_pool()` helper spawned from the Tauri `setup` closure. Sends HEAD requests to Deepgram, AssemblyAI, and Anthropic hosts on launch.
- Uses 10s timeout + 5s connect timeout + `http1_only()`. Failures ignored — warmup is best-effort.
- First user-initiated verify / summary call no longer eats 6–10s of cold TLS handshake.

### 3. "Connecting…" spinner

- [toolbar.tsx](src/components/layout/toolbar.tsx): Start Service button now shows `Loader2Icon` with `animate-spin` while `connectionStatus === "connecting"`. Tooltip: "Connecting to STT provider (first launch can take 10–20s)". Visual feedback during the 10–21s cold-start window.

### 4. `SttProvider` handle in `AppState`

- [state.rs](src-tauri/src/state.rs): new `stt_provider: Option<Arc<dyn SttProvider>>` field.
- [stt.rs](src-tauri/src/commands/stt.rs):
  - `Box<dyn SttProvider>` → `Arc<dyn SttProvider>` at construction. All three providers (Whisper / AssemblyAI / Deepgram) wrap in `Arc::new`.
  - `start_transcription` clones the `Arc` into `AppState` before moving it into the provider task.
  - `stop_transcription` now calls `provider.stop()` on the stored handle, flipping each provider's internal `cancelled` AtomicBool. No longer relies on the audio channel drop chain to propagate cancellation.
- Cleaner stop semantics; late-event drain fix (earlier this session) now has a deterministic companion for the provider side.

### 5. Transcript-store reconnect regression test

- New [transcript-store.test.ts](src/stores/transcript-store.test.ts) with 5 cases covering learnings #16 + #17:
  - `stt_connected` flips `isTranscribing=true`
  - `stt_disconnected` does NOT flip `isTranscribing=false` (regression guard)
  - Full silence-close → reconnect cycle keeps UI alive
  - `stt_error` is terminal — flips `isTranscribing=false`
  - 5 back-to-back disconnect/reconnect cycles preserve state
- Test mirrors the handler logic in [transcript-panel.tsx](src/components/panels/transcript-panel.tsx) so any future change that re-introduces the "flip on disconnect" bug fails the test.
- Vitest suite now 16 tests across 4 files.

### 6. E2E framework sketch

- [2026-04-19-stt-e2e-framework-design.md](docs/superpowers/specs/2026-04-19-stt-e2e-framework-design.md): design-only doc for the speak/silence/resume scenario.
- Stack: Playwright + Tauri v2 + BlackHole virtual mic + pre-recorded WAV fixtures. Zustand store snooping for assertions.
- 1-day build split into 4 × 0.5-day phases. Open questions for user: Deepgram credits in CI? Whisper coverage in v1?
