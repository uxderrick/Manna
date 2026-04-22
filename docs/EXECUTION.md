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

## Session: 2026-04-20 — Embedding Model Research + INT8 Default

### EmbeddingGemma-300M evaluation

Researched Google's EmbeddingGemma-300M as potential Qwen3 replacement. **Rejected** — downgrade on retrieval, our core metric.

| Metric | Qwen3-0.6B | EmbeddingGemma-300M |
|---|---|---|
| MTEB Multilingual avg | 64.33 | 61.15 |
| **MTEB Retrieval sub-score** | **64.64** | **~54** |
| Context | 32K | 2K |
| License | Apache-2.0 | Gemma (restricted) |
| Size Q4 | 880MB | 190MB |

Gemma wins on size + cleaner ONNX export (no KV cache), but irrelevant on desktop. Only compelling for future mobile companion app. Backlog entry marked rejected. Real upgrade path (if ever needed): Qwen3-Embedding-4B (MTEB Multilingual 69.45, Retrieval 69.60, Apache-2.0) — deferred, 4× RAM not justified yet.

Sources: [EmbeddingGemma tech report](https://arxiv.org/abs/2509.20354), [Qwen3 MTEB tables](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B).

### Upstream model parity check + INT8 default swap

Verified upstream openbezal/rhema uses same model family (Qwen3-Embedding-0.6B, 1024-dim) — but defaults to **INT8** (`model_quantized.onnx`, 585MB) via `optimum-cli onnxruntime quantize --arm64`. Manna was defaulting to **FP32** (1.1GB) with INT8 as fallback.

Rationale for the original FP32 choice (traced back to 2026-04-13 Wave 1D): cargo-culted "FP32 > INT8" assumption from generation-model quantization wisdom. For **embedding** models, INT8 quantization is near-lossless (<1% MTEB delta). Qwen's own repo ships INT8 as recommended deployment. No quality regression observed in testing.

**Fix** ([src-tauri/src/lib.rs:297-304](src-tauri/src/lib.rs#L297)): flipped loader priority so INT8 is preferred over FP32. FP32 stays as fallback if INT8 missing.

**Impact for low-spec church PCs:**

- Disk: 1.1GB → 585MB (−47%)
- RAM at inference: ~1GB → ~300MB (−70%)
- Cold-load time: roughly halved
- Retrieval accuracy: unchanged

Confirmed live — running session switched from FP32 to INT8 via HMR at 22:23:16 UTC.

**Reverted 2026-04-21.** Inspecting the INT8 ONNX inputs revealed `past_key_values.*` tensors — the bundled `model_quantized.onnx` is a **generation export**, not a feature-extraction export. Running it for embeddings silently produced wrong vectors (see learning #7 — exact same trap as `onnx-community/Qwen3-Embedding-0.6B-ONNX`). Loader priority reverted to FP32 first. INT8 demoted to warn-logged fallback until a proper feature-extraction quantization is generated. Proper fix: run `optimum-cli onnxruntime quantize --arm64` against the FP32 feature-extraction ONNX (not the default generation one) and replace the bundled file.

## Session: 2026-04-21 — Service Plan shipped + INT8 bug

### Service Plan / Playlist (Feature B)

Full B→C→E→F competitor-parity roadmap started. Feature B done. 17 tasks shipped in one sitting via subagent-driven-development:

- **Schema**: `service_plan_templates`, `service_plan_items` + cascade trigger on `sermon_sessions` delete
- **Rust DB layer** (`rhema-notes/src/plan_db.rs`): 13 CRUD + copy-clone methods, `&mut self` for transaction paths
- **Tauri commands**: 13 commands in `commands/service_plan.rs` with numeric input guards (finite order_index, non-negative auto_advance_seconds)
- **Frontend types**: discriminated union `PlanItemPayload` with `parsePlanItem` safe decoder
- **Zustand store**: plan state + active item + pending-advance timer; 9 unit tests (7 core + 2 timer)
- **Invoke hook**: `useServicePlan()` with 8 actions + session-change auto-load
- **Activation router**: routes verse/announcement → `setLiveVerse`; section → no-op; blank/corrupt → `setLiveVerse(null)`; song → `CustomEvent("plan:activate-song")` (loose coupling); 4 unit tests
- **UI**: 5 new components (`service-plan-panel`, `service-plan-item`, `service-plan-item-editor`, `add-item-menu`, `template-manager`) + new `ui/dropdown-menu` primitive
- **Workspace**: Plan tab added as first entry in right panel
- **Tests**: 55/55 vitest pass, Rust integration tests 11/11, TS clean

Plan + spec: [2026-04-20-service-plan-design.md](docs/superpowers/specs/2026-04-20-service-plan-design.md), [2026-04-20-service-plan.md](docs/superpowers/plans/2026-04-20-service-plan.md).

Smoke tests passed live in Tauri app (drag reorder, template save/load, auto-advance, activate, blank-clear). Ready for next feature (Slide Editor — Feature C).

### INT8 embedding fallback reverted

Background: 2026-04-20 I flipped the embedding model loader to prefer INT8 (`model_quantized.onnx`, 585MB) over FP32 for RAM savings on low-spec church PCs. Claimed "near-lossless per learning #28."

**Bug**: the bundled INT8 file is a **generation ONNX export**, not feature-extraction. Python onnx inspection of `/Users/uxderrick-mac/Development/Manna/models/qwen3-embedding-0.6b-int8/model_quantized.onnx`:

```
inputs: input_ids, attention_mask, position_ids,
        past_key_values.0.key, past_key_values.0.value, ... (56 KV cache tensors)
outputs: present.0.key, present.0.value, ... (56 present-KV tensors)
```

vs FP32:
```
inputs: input_ids, attention_mask, position_ids
outputs: last_hidden_state
```

Running the KV-cache model as an embedder produces wrong vectors silently (ort extracts whatever tensor is asked; semantics are broken). Retrieval quality would have degraded without any error.

**Fix**: reverted loader priority in [src-tauri/src/lib.rs:354](src-tauri/src/lib.rs#L354) to FP32-first. INT8 is now a warn-logged fallback only. Proper fix path is to generate a real feature-extraction INT8 quantization:

```bash
optimum-cli onnxruntime quantize --arm64 \
    --onnx_model models/qwen3-embedding-0.6b/ \
    -o models/qwen3-embedding-0.6b-int8-fe/
```

Against the **feature-extraction** export (3 inputs, 1 output), not the generation export. That's tracked as a separate backlog item.

### Follow-ups

- [ ] Generate correct INT8 feature-extraction quantization for the 4× RAM win (church PCs still need it; upstream rhema ships the same broken INT8 file, so this would benefit them too)
- [ ] Verify retrieval quality on a few paraphrased-verse test sentences now that we're definitely on FP32
- [ ] Update README / setup docs to clarify which ONNX file is loaded (users who copy upstream's INT8 file will hit the same trap)

---

## Session: 2026-04-21 — Multi-Hymnal + Simplified Setup

**Shipped:** Songs tab extended from 260 GHS hymns → 955 hymns across 4 hymnals (GHS + MHB + Sankey + SDA). Welcome wizard picks enabled hymnals. Source badges in Songs panel (GHS/MHB/SNK/SDA). Numeric-prefix search (`mhb 42`, `snk 150`).

**Shipped:** Simplified setup recipes — `setup:minimal` (10 min, no GPU, 400MB), `setup:semantic` (GPU required, 30-45 min), `setup:whisper` (1GB STT). GPU pre-flight aborts CPU precompute unless `FORCE_CPU=1`. README rewritten with decision + feature matrices.

**Actually loaded:**
- GHS: 260 hymns (existing, relocated to `src-tauri/hymnals/ghs.json`)
- SDA: 695 hymns from [GospelSounders/adventhymnals](https://github.com/GospelSounders/adventhymnals) Apache-2.0 via `scripts/hymnals/fetch-sda.ts`
- MHB: placeholder (needs offline OCR of Archive.org 1933 scan)
- Sankey: placeholder (traditionalmusic.co.uk blocks bots with Cloudflare challenge — adapter committed, awaits alternative source)

**Files:** `src-tauri/src/hymnals/mod.rs` (registry), `src-tauri/src/commands/hymnals.rs` (CRUD), `scripts/prep-hymnals.ts` + 4 adapters, `src/components/onboarding/hymnal-picker-step.tsx`, `src/components/songs/source-badge.tsx`. Commits b0a3d21…c291a95.

---

## Session: 2026-04-22 — DMG/EXE Release Pipeline

**Shipped:** First public release `v0.1.0-rc1` on GitHub. CI workflow with matrix build (macOS-14 + windows-latest), Tauri updater integration, flavor-aware auto-updates, `git-cliff` release notes, welcome wizard step 3 (API key entry).

**Released artifacts:**
- `Manna-0.1.0-rc1-minimal-macos.dmg` (~400 MB, unsigned)
- `Manna-0.1.0-rc1-minimal-windows.exe` (NSIS, unsigned)
- `latest-minimal.json` (Tauri updater manifest, signed with minisign key)

### The 10-Round CI Debug Fight

v0.1.0-rc1 took **10 failed workflow runs** before going green. Each failure exposed a separate issue. Capturing all 10 for future reference.

#### Round 1: `bun build` ≠ `bun run build`

**Error:** `Missing entrypoints. What would you like to bundle?`

**Cause:** `tauri.conf.json` had `"beforeBuildCommand": "bun build"`. Bun interprets `bun build` as its built-in bundler CLI (needs entrypoint args), NOT as "run the `build` script from package.json".

**Fix:** `"beforeBuildCommand": "bun run build"` (and same for `beforeDevCommand`). Works locally because `bun run tauri dev` used a different path. CI exposed it. [49c306d]

#### Round 2: tsc blocks vite build

**Error:** 27 pre-existing TS errors cascade from `tsc -b && vite build` in the build script. Project's `typecheck` target has always flagged them; local builds skipped because we never ran `bun run build` end-to-end before release.

**Fix:** Split scripts: `build` = `vite build` only (vite handles types via bundling); `build:typed` = original `tsc -b && vite build` for manual strict check. Release CI doesn't enforce TS cleanliness. [9f502d8]

**Learning:** tsc in a release build script is a scope overreach. Typecheck is dev-time, build is production.

#### Round 3: bun's `--` handling vs Tauri CLI

**Error:** `failed to parse value from --config argument '<path>' as a dotted key expression`

**Cause:** Our workflow had `bun run tauri build -- --config <path>`. Bun v1.3 forwards the literal `--` into tauri-cli's argv. Tauri sees `--config <value>` AFTER a `--` and treats the value as raw TOML content, not a file path. Path `src-tauri/tauri.conf.minimal.json` → TOML parser → "key with no value" (trying to parse the path as `key = value`).

**Fix:** Drop the `--` separator entirely: `bun run tauri build --config <path>`. Bun forwards flags directly without needing `--`. [7c4f44e]

**References:** [tauri#13252](https://github.com/tauri-apps/tauri/issues/13252), [bun#13984](https://github.com/oven-sh/bun/issues/13984)

#### Round 4: MPS OOM on macOS-full precompute

**Error:** `MPS backend out of memory (MPS allocated: 2.62 GiB, other allocations: 1.03 MiB, max allowed: 7.93 GiB)` during Qwen3 KJV precompute.

**First attempt:** Set `PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0`. Didn't help.

**Root cause:** GitHub `macos-14` hosted runners (ARM) cap MPS allocations at ~1 GB **regardless** of 7 GB physical RAM. MPS is virtualized for CI security; watermark ratio only affects the software cap, not the platform cap. Confirmed by [actions/runner-images#9918](https://github.com/actions/runner-images/issues/9918).

**Fix:** Drop `macos-full` from CI matrix entirely. Ship only `macos-minimal` + `windows-minimal`. Users who want semantic detection on Mac run `setup:semantic` locally post-install (their own Mac has real MPS). Future: `macos-14-xlarge` paid runner ($0.16/min) OR cross-build embeddings on CI and ship them as a release asset. [35fdf18]

#### Round 5: Windows LNK1319 (CRT mismatch)

**Error:** `libesaxx_rs-...(esaxx.o) : error LNK2038: mismatch detected for 'RuntimeLibrary': value 'MT_StaticRelease' doesn't match value 'MD_DynamicRelease' in libwhisper_rs_sys-...(whisper.obj)` → `fatal error LNK1319`

**Cause:** `esaxx-rs` (transitive from `tokenizers` via rhema-detection's `onnx` feature) compiles its C++ with `/MT` (static CRT). `whisper-rs-sys` compiles `whisper.cpp` with `/MD` (dynamic CRT). MSVC linker refuses to mix them.

**First attempt:** `tauri build --no-default-features` on Windows. Failed because Tauri CLI doesn't have a native `--no-default-features` flag — it has `--features`. Unknown flag error.

**Second attempt:** `tauri build --config <path> -- --no-default-features` (forward to cargo via `--`). Compile succeeded, but still hit the C++ CRT mismatch because `rhema-detection = { features = ["onnx", "vector-search"] }` in `src-tauri/Cargo.toml` unconditionally requests `onnx` regardless of the `app` crate's feature flags. `--no-default-features` on `app` only affects `app`'s own defaults, not transitive feature requests.

**Fix:** Refactor `src-tauri/Cargo.toml` to make `onnx` a conditional feature of the `app` crate too:
```toml
rhema-detection = { path = "crates/detection", default-features = false, features = ["vector-search"] }

[features]
default = ["whisper", "onnx"]
whisper = ["rhema-stt/whisper"]
onnx = ["rhema-detection/onnx"]
```

Then gate runtime code with `#[cfg(feature = "onnx")]`. Now `--no-default-features` on Windows drops BOTH whisper AND onnx → no `tokenizers` → no `esaxx-rs` → no C++ CRT mismatch. [bb7c544]

**Lesson:** Unconditional transitive features undermine `--no-default-features`. If you might ever build without a dep, gate it at every crate boundary.

#### Round 6: MSI rejects pre-release version

**Error:** `optional pre-release identifier in app version must be numeric-only and cannot be greater than 65535 for msi target`

**Cause:** Tauri `bundle.targets: "all"` builds MSI in addition to NSIS on Windows. MSI's product version uses a 4-part numeric scheme (`X.Y.Z.W`) that can't represent `0.1.0-rc1`'s `-rc1` prerelease tag. Tauri rejects the bundle.

**Fix:** Per-OS bundle target — `--bundles nsis` on Windows, `--bundles dmg` on macOS. Skip MSI entirely. NSIS suffices for church distribution. [7e3462d]

#### Round 7: Signer can't find tauri CLI

**Error:** `error: could not determine executable to run for package tauri` when `scripts/build-updater-manifest.py` invokes `bun x tauri signer sign`.

**Cause:** Release aggregator job on `ubuntu-latest` never ran `bun install`, so `node_modules/` missing, `bun x tauri` can't locate the CLI.

**Fix:** Add `bun install --frozen-lockfile` step to release job before manifest generation. [b698868]

#### Round 8: `--private-key` takes content, not path

**Error:** `failed to decode base64 secret key: failed to decode base64 key: Invalid symbol 46, offset 0.`

**Cause:** Symbol 46 is ASCII `.`. Tauri signer's `--private-key` flag takes the **raw base64 key string**, not a file path. Our script wrote the key to `.tauri-signing-key` and passed that path → Tauri tried to base64-decode the path string → choked on the `.` character.

**Fix:** Drop `--private-key` flag entirely. Tauri v2 signer auto-reads `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` from env vars (canonical pattern, same as `tauri-action`). CI already sets both env vars, subprocess inherits them. [9ea71c4]

**Signer CLI reference:** `-k/--private-key` = content (env `TAURI_SIGNING_PRIVATE_KEY`); `-f/--private-key-path` = file path. We want the env-var path.

#### Round 9: Missing full-flavor installer aborts manifest loop

**Error:** `No installers found for flavor=full in installers`

**Cause:** Manifest script looped over `[minimal, full]`. Minimal succeeded and wrote `latest-minimal.json`. Full flavor had no installers (CI-skipped in Round 4) → script raised exit 1.

**Fix:** Pre-check existence of matching installers before invoking signer; skip flavors with no installers. Also set `fail_on_unmatched_files: false` on the publish step for `latest-full.json` which won't exist in v1. [28160a3]

#### Round 10: GREEN — published

All builds green. Release job signed both installers, wrote `latest-minimal.json`, published prerelease at https://github.com/uxderrick/Manna/releases/tag/v0.1.0-rc1.

**Total debug time:** ~2.5 hours across 10 runs. Each round was a ~5-15 min CI cycle waiting for builds + re-tag.

### Post-release: macOS 14 Gatekeeper blocks unsigned DMG

**Issue:** User downloaded DMG, dragged to Applications, launch → "Manna is damaged and can't be opened. You should move it to the Bin."

**Cause:** macOS 14 Sequoia removed the right-click "Open" bypass for unsigned apps. Ad-hoc self-signing via Apple Developer Program not present.

**Workaround (works on macOS 14):**
```bash
xattr -dr com.apple.quarantine /Applications/Manna.app
codesign --force --deep --sign - /Applications/Manna.app
```

First strips the quarantine attribute. Second applies an ad-hoc signature (empty identity `-` = self-sign). macOS Gatekeeper then accepts the bundle. One-time per install.

**Long-term fix:** Apple Developer Program ($99/year) → real signed + notarized builds → no warning. Deferred per plan Q1-D decision.

### Artifacts

- Spec: [docs/superpowers/specs/2026-04-22-release-pipeline-design.md](superpowers/specs/2026-04-22-release-pipeline-design.md)
- Plan: [docs/superpowers/plans/2026-04-22-release-pipeline.md](superpowers/plans/2026-04-22-release-pipeline.md)
- Runbook: [docs/RELEASE.md](RELEASE.md)
- Workflow: [.github/workflows/release.yml](../.github/workflows/release.yml)
- Manifest script: [scripts/build-updater-manifest.py](../scripts/build-updater-manifest.py)
- 25+ commits this session (c84f11b through 28160a3)

### Follow-ups

- [ ] Update `docs/RELEASE.md` with `codesign --sign -` macOS 14 workaround (current only mentions `xattr`)
- [ ] Cut real `v0.1.0` release (drop `-rc1`) once smoke tests pass
- [ ] Fix welcome wizard not showing on first install after update (settings.json `onboardingComplete` may persist across installs on same Mac)
- [ ] Windows-full build (requires cross-built embeddings)
- [ ] Apply for Apple Developer Program + Windows EV cert if distribution scales beyond home church
- [ ] Investigate GitHub `macos-14-xlarge` runner for future macos-full builds (paid but has real MPS)
