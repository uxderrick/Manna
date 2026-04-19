# Backlog

Unscheduled work. Grouped by type. Items pulled from EXECUTION.md history and this session. Priority is rough — shuffle as needed.

---

## Features

### Songs tab (Wave 2)

- `ghs.json` (Ghana Hymn Society) data already bundled in `src-tauri/`
- No UI yet — placeholder only
- **Est:** 2–3 days (panel UI, search, queue integration, broadcast send)
- **Priority:** medium — useful for service flow but not blocking live detection

### Planner tab

- Not yet scoped
- Intent: pre-service sermon outline → expected verses → pre-warm detection context
- **Est:** needs brainstorming first (0.5 day) then 3–5 days build
- **Priority:** low until Songs ships

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

### Overlay themes

- Plan written: [docs/superpowers/plans/2026-04-13-overlay-themes.md](superpowers/plans/2026-04-13-overlay-themes.md)
- Not executed
- **Est:** see plan
- **Priority:** medium — visual quality for broadcast output

### Verse history + analytics

- Plan written: [docs/superpowers/plans/2026-04-14-verse-history-analytics.md](superpowers/plans/2026-04-14-verse-history-analytics.md)
- Not executed
- **Est:** see plan
- **Priority:** medium — useful for post-service review

---

## ML / Detection Pipeline

### Precompute embeddings for non-KJV English translations

- Currently only KJV has embeddings — semantic detection runs against KJV text then maps ref → user's active translation
- Precompute for NIV, ESV, NASB, NKJV, NLT, AMP, etc. (9 bundled)
- **Est:** 1–2 hr per translation on MPS (Qwen3), ~1 day total
- **Priority:** low — current approach works, ref mapping is lossless

### EmbeddingGemma-300M model swap

- Current: Qwen3-Embedding-0.6B (1024-dim, ~1.1GB)
- Target: EmbeddingGemma-300M (768-dim matryoshka, ~600MB, multilingual 100+ languages)
- Benefits: smaller disk/RAM, faster cold-load, supports non-English Bibles (Twi/Ga/Ewe), matryoshka truncation for 4× smaller index
- **Est breakdown:**
  - Download ONNX + tokenizer: 30 min (HF pre-built, ~600MB)
  - Verify loads in `ort` crate (FP16/pooling may differ, see learning #7/#8): 1–2 hr
  - Precompute KJV: 10–15 min (MPS)
  - Precompute other English translations (9×): 1–2 hr
  - Precompute multilingual (Twi/Ga/Ewe): 3–5 hr — requires sourcing scripture data first
  - Threshold tuning vs Qwen3 scores (learning #14): 2–3 hr
  - Multi-model toggle in settings (optional): 3–4 hr
  - Docs + LEARNINGS entry: 30 min
- **Totals:**
  - English only, replace Qwen3: ~1 day (6–8 hr)
  - English + multi-model toggle: ~2 days
  - Full multilingual (need non-English Bibles sourced first): 3–5 days
- **Unknowns:**
  - Whether pre-built EmbeddingGemma ONNX exists in feature-extraction export (not generation). Last time with Qwen3, 2 of 3 HF repos had wrong export.
  - Non-English Bible sourcing (Ghana Bible Society? scraping? copyright).
- **Priority:**
  - English-only perf boost: skip (Qwen3 works, not worth 8 hr)
  - Twi/Ga/Ewe for Ghana church: worth 3–5 days once translations sourced

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
