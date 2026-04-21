# Backlog

Unscheduled work. Grouped by type. Items pulled from EXECUTION.md history and this session. Priority is rough — shuffle as needed.

---

## Features

### ~~Songs tab (Wave 2)~~ ✅ shipped (pending smoke test)

- Spec: `docs/superpowers/specs/2026-04-20-songs-tab-design.md`
- Plan: `docs/superpowers/plans/2026-04-20-songs-tab.md`
- Shipped: 260 GHS hymns seeded at startup, local fuzzy search (minisearch), Genius API lookup, paste-lyrics fallback, typed shared queue (verse + song-stanza union), per-hymn line-mode + auto-chorus toggles, Cmd+G quick-jump, queue auto-prune on song delete
- 17 new Vitest unit tests passing (expandSong × 7, songMeta × 4, searchSongs × 6)
- Manual smoke test pending in live Tauri app

### ~~Service Plan / Playlist (Feature B)~~ ✅ shipped 2026-04-21

- Spec: [docs/superpowers/specs/2026-04-20-service-plan-design.md](superpowers/specs/2026-04-20-service-plan-design.md)
- Plan: [docs/superpowers/plans/2026-04-20-service-plan.md](superpowers/plans/2026-04-20-service-plan.md)
- Shipped: 5 item types (verse/song/announcement/section/blank), templates + per-session copies, click-to-activate + optional auto-advance, drag-reorder via HTML5 DnD, keyboard nav (↑/↓/Enter), template save/load, clone-from-past-session
- 13 Rust CRUD methods, 13 Tauri commands, 11 Rust integration tests + 11 TS unit tests, all passing
- Smoke-tested live — drag reorder, templates, auto-advance all work
- Foundation for Features C (Slide Editor), E (Media Playback), F (Theme Editor) to slot into

### Planner tab

- Not yet scoped
- Intent: pre-service sermon outline → expected verses → pre-warm detection context
- Overlaps heavily with Service Plan now shipped — may reframe as "AI-assisted plan generation" layered on top
- **Est:** needs brainstorming first (0.5 day) then 2–3 days build (reduced since Plan exists)
- **Priority:** low until Slide Editor + Media ships

### Remote control web UI redesign

- Current remote control panel works but looks dated
- Target: match new Manna warm OKLCH palette, mobile-friendly
- **Est:** 2–3 days
- **Priority:** low

### DMG / EXE release pipeline

- GitHub Actions workflow to bundle signed installers
- Must bundle `rhema.db` (Bible + cross-refs) inside app
- Prompt for API key on first launch
- Make ONNX semantic search optional (skip-download path for smaller installer)
- **Est:** 3–5 days (cert setup, notarization for macOS, Windows code signing)
- **Priority:** high — blocks church distribution

### Simplified setup docs

- Current setup script takes 2.5+ hours (Qwen3 precompute)
- Add: timeline/bandwidth expectations, GPU detection warning, "minimal setup" path skipping ONNX + embeddings precompute
- **Est:** 1 day
- **Priority:** medium

### Cloud hosting (thin client + cloud hybrid)

- Run STT + detection in cloud, thin Tauri client just renders + broadcasts
- Enables lower-end hardware for church PCs
- **Est:** 2+ weeks (infra, auth, billing model)
- **Priority:** research-phase only

### ~~Overlay themes~~ ✅ shipped

- Plan: [docs/superpowers/plans/2026-04-13-overlay-themes.md](superpowers/plans/2026-04-13-overlay-themes.md)
- All 7 implementation tasks complete (type, 4 new themes, divider/centered-lines renderer, CanvasVerse monitors, DB CRUD, Tauri commands, hydration)
- Task 8 smoke test pending live app verification

### ~~Verse history + analytics~~ ✅ shipped

- Plan: [docs/superpowers/plans/2026-04-14-verse-history-analytics.md](superpowers/plans/2026-04-14-verse-history-analytics.md)
- Built: [analytics-panel.tsx](../src/components/panels/analytics-panel.tsx), [session-detail.tsx](../src/components/panels/session-detail.tsx), [analytics.rs](../src-tauri/src/commands/analytics.rs), workspace wiring
- Plan checkboxes unmarked in file but implementation complete (verified 2026-04-19)

---

## ML / Detection Pipeline

### Precompute embeddings for non-KJV English translations

- Currently only KJV has embeddings — semantic detection runs against KJV text then maps ref → user's active translation
- Precompute for NIV, ESV, NASB, NKJV, NLT, AMP, etc. (9 bundled)
- **Est:** 1–2 hr per translation on MPS (Qwen3), ~1 day total
- **Priority:** low — current approach works, ref mapping is lossless

### Proper INT8 feature-extraction quantization for Qwen3

- Current state (2026-04-21): bundled `models/qwen3-embedding-0.6b-int8/model_quantized.onnx` is a **generation export** with KV cache inputs — wrong for embeddings. FP32 forced as default in loader. INT8 demoted to warn-logged fallback.
- Fix: run `optimum-cli onnxruntime quantize --arm64` against the FP32 **feature-extraction** ONNX (3 inputs, 1 output), not the default generation export. Replace bundled INT8 file.
- Payoff: 4× RAM savings on low-spec church PCs without quality loss (per learning #28), identical to upstream rhema's default deployment — but with a *correct* export this time.
- **Est:** ~1 hr (quantize + verify inputs + commit)
- **Priority:** medium — affects all church PCs, plus benefits upstream rhema users who inherit the same broken file

### ~~EmbeddingGemma-300M model swap~~ ❌ rejected 2026-04-19

Researched vs current Qwen3-Embedding-0.6B. **Gemma is a downgrade on retrieval — our core metric.**

| Metric | Qwen3-0.6B | EmbeddingGemma-300M |
|---|---|---|
| MTEB Multilingual avg | 64.33 | 61.15 |
| **MTEB Retrieval sub-score** | **64.64** | **~54** |
| Context | 32K | 2K |
| License | Apache-2.0 | Gemma (restricted) |
| Size Q4 | 880MB | 190MB |

Gemma wins on size (5×) and cleaner ONNX (no KV cache), but that's irrelevant on desktop. Only compelling for a future mobile companion app. Source: [research 2026-04-19], [EmbeddingGemma tech report](https://arxiv.org/abs/2509.20354), [Qwen3 MTEB tables](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B).

### Qwen3-Embedding-4B upgrade (real upgrade path)

- Current: Qwen3-Embedding-0.6B (MTEB Multilingual 64.33, Retrieval 64.64)
- Target: Qwen3-Embedding-4B (MTEB Multilingual **69.45**, Retrieval **69.60**) — same family, Apache-2.0
- Trade-off: ~4× RAM + ~4× cold-load time. Likely 4–6 GB RAM at inference, 4–8 GB ONNX file.
- **Est:** ~1 day (download ONNX, verify `ort` loads, precompute KJV on MPS ~10 hr, threshold retune, docs)
- **Priority:** low — 0.6B works well for live sermon detection. Only justifies if false-negative rate on paraphrased verses becomes a real complaint.
- **Unknown:** whether ONNX feature-extraction export exists on HF without KV cache (learning #7).

---

## Tech Debt / Reliability

> All 6 items below were cleared in the 2026-04-19 tech debt sweep. Kept here for history — see [EXECUTION.md](EXECUTION.md) "Session: 2026-04-19 (cont)" for details.

### ~~Store `SttProvider` handle in `AppState`~~ ✅ Done 2026-04-19

- `Arc<dyn SttProvider>` stored in `AppState.stt_provider`
- `stop_transcription` now calls `provider.stop()` directly — deterministic cancellation
- Commit: [src-tauri/src/state.rs](../src-tauri/src/state.rs), [src-tauri/src/commands/stt.rs](../src-tauri/src/commands/stt.rs)

### ~~Convert `emitTo` → scoped `emit` in broadcast-settings.tsx~~ ✅ Done 2026-04-19

- All 3 NDI config `emitTo` call sites switched to `emit("broadcast:ndi-config:${outputId}", ...)`
- Listener in `broadcast-output.tsx` updated to match
- `broadcast:output-ready` kept on `emitTo` (low-volume, reverse direction)

### ~~Integration test: Deepgram silence-close → reconnect~~ ✅ Done 2026-04-19

- New `src/stores/transcript-store.test.ts` with 5 regression cases
- Guards learnings #16 and #17 — `stt_disconnected` must not flip `isTranscribing=false`
- Vitest suite now 16 tests

### ~~E2E verify: 30s speak → 15s silence → resume~~ 🟡 Design-only 2026-04-19

- Design sketch in [docs/superpowers/specs/2026-04-19-stt-e2e-framework-design.md](superpowers/specs/2026-04-19-stt-e2e-framework-design.md)
- Stack: Playwright + Tauri v2 + BlackHole virtual mic + pre-recorded WAV
- Build estimate: 1 day (4 × 0.5-day phases)
- **Blockers to ask user about:** Deepgram/AAI credits in CI? Whisper coverage needed in v1?
- **Priority:** low — design captured, build deferred

### ~~"Connecting…" progress indicator~~ ✅ Done 2026-04-19

- `Loader2Icon` with `animate-spin` on Start Service button during `connectionStatus === "connecting"`
- Tooltip hint for cold-start wait expectation
- Commit: [src/components/layout/toolbar.tsx](../src/components/layout/toolbar.tsx)

### ~~Warm reqwest / rustls connection pool at startup~~ ✅ Done 2026-04-19

- `warm_connection_pool()` helper in [lib.rs](../src-tauri/src/lib.rs) — HEAD requests to Deepgram / AssemblyAI / Anthropic on app launch
- 10s timeout + 5s connect timeout + `http1_only()`
- First user-initiated verify call no longer pays 6–10s cold-TLS cost

---

## Research / Long-horizon

- **Cloud hybrid architecture** — thin client + cloud STT/detection (est: 2+ weeks, research-phase only)
- **Twi/Ga/Ewe Bible sourcing** — dependency for EmbeddingGemma multilingual work (legal + data wrangling, timeline TBD)
