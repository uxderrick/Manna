# Manna vs Rhema — feature comparison

Manna is a friendly fork of [openbezal/rhema](https://github.com/openbezal/rhema). This page is the authoritative list of what's shared, what Manna adds, and what Manna changes.

If a feature isn't listed under **Manna additions** or **Manna changes**, assume it comes from rhema and credit belongs upstream.

---

## Shared with upstream rhema

Real-time sermon verse detection — these are rhema's core. Manna inherits them unchanged (or lightly refactored):

- Real-time speech-to-text via **Deepgram Nova-3** (WebSocket streaming)
- Local **Whisper** STT (`ggml-large-v3-turbo`) as an offline option
- Multi-strategy verse detection pipeline:
  - Direct reference parsing (Aho-Corasick + fuzzy matching)
  - Semantic search (Qwen3-0.6B ONNX embeddings + HNSW vector index)
  - Quotation matching against verse text
  - Cloud booster (OpenAI / Claude)
  - Sermon context tracking + sentence buffering
  - Reading-mode classifier (reading vs. referencing)
- SQLite Bible database (FTS5)
- Multiple translations: KJV, NIV, ESV, NASB, NKJV, NLT, AMP + ES / FR / PT
- Cross-reference lookup (340k+ refs, openbible.info)
- **NDI broadcast output** for live production
- **Theme designer** — canvas editor with backgrounds, text styling, positioning, shadows, outlines
- Audio level metering, live indicator, session timer
- Data pipeline: download translations, build SQLite DB, export ONNX model, precompute embeddings
- Tauri v2 desktop app, React 19 frontend, Rust workspace backend

---

## Manna additions

### Speech-to-text

| Feature | File(s) |
|---|---|
| **AssemblyAI Universal-Streaming v3 provider** (word-level confidence, keyterm prompting) | `src-tauri/crates/stt/src/assemblyai.rs` |
| **Shared WebSocket runtime** — Deepgram + AssemblyAI share one connect / reconnect / audio-drop loop | `src-tauri/crates/stt/src/ws_runtime.rs` |
| **`TranscriptEvent::Reconnecting`** + `stt_reconnecting` Tauri event — transient drops no longer tear down the UI | `stt/src/types.rs`, `commands/stt.rs` |
| **API-key verifier commands** — HTTP auth probe + WebSocket handshake for each provider | `commands/stt.rs` (`verify_deepgram_key`, `verify_assemblyai_key`) |
| **Test buttons** in Settings → Speech with inline ✓ / ✗ + detail | `components/settings-dialog.tsx` |
| AssemblyAI keyterms module expanded | `stt/src/keyterms.rs` |

### Sermon workflow

| Feature | File(s) |
|---|---|
| **Persistent sessions** — transcript, detections, notes saved per service in a separate SQLite layer | `src-tauri/crates/notes/src/db.rs`, `commands/session.rs`, `types/session.ts` |
| **Start Service** — one-click: create session → preflight → start transcription | `components/controls/`, session store |
| **Pre-flight checklist** — mic / API key (per provider) / network | `components/preflight-checklist.tsx` |
| **Sessions panel** — auto-named with date/time, newest-first, editable titles | `components/panels/sessions-panel.tsx` |
| **Session detail**, **resume session dialog**, **end session dialog** | `components/panels/session-detail.tsx`, `components/session/*` |
| **History panel** — 99%+ confidence verses auto-added | `components/panels/history-panel.tsx` |
| **Analytics panel** — per-session + aggregate stats | `components/panels/analytics-panel.tsx`, `commands/analytics.rs` |
| **Cross-reference panel** — live lookup alongside the broadcast verse | `components/panels/crossref-panel.tsx` |
| **Notes panel** — per-session sermon notes | `components/panels/notes-panel.tsx` |
| **Planner panel** — merged into the Queue; search + add + reorder | `components/panels/planner-panel.tsx` |
| **Session export drawer** — clipboard, markdown, JSON, print | `components/session/export-notes-drawer.tsx`, `lib/export-notes-drawer.ts` |
| **AI sermon summary** via Claude (`claude-haiku-4-5`, short-transcript + overload fallbacks) | `lib/summarize.ts` |
| **Distribute summary drawer** | `components/session/distribute-summary-drawer.tsx` |

### App shell

| Feature | File(s) |
|---|---|
| **Command palette** (cmdk) — jump to any action, panel, setting | `components/command-palette.tsx`, `lib/command-registry.ts` |
| **Native app menu** + hook bridging menu items to in-app actions | `src-tauri/src/menu.rs`, `hooks/use-menu-events.ts` |
| **Workspace / tabbed panels / toolbar** layout refactor | `components/layout/workspace.tsx`, `panel-tabs.tsx`, `toolbar.tsx` |
| **Welcome dialog**, **About dialog**, **Announcement dialog** | `components/{welcome,about}-dialog.tsx`, `components/broadcast/announcement-dialog.tsx` |
| **Vaul drawers** for long-form flows | `components/ui/drawer.tsx` + multiple `-drawer.tsx` consumers |
| **Theme library** with curated built-in broadcast themes (~324 lines of presets) | `lib/builtin-themes.ts`, `components/broadcast/theme-library.tsx` |
| **Broadcast monitor** operator preview | `components/broadcast/broadcast-monitor.tsx` |
| **Themes command table** — save / list / delete custom themes | `commands/themes.rs` |

### Detection

| Change | File(s) |
|---|---|
| **Fix:** removed bogus `"one" → 100` mapping in `parse_tens` that caused "chapter one" to misparse as 100 | `detection/src/reading_mode.rs` |
| Reading-mode refinements | `detection/src/reading_mode.rs` |

### Branding + tooling

- Package renamed `rhema` → `manna`, bundle ID `com.manna.app`
- `docs/superpowers/{specs,plans}/` — design specs and implementation plans for Manna features
- `docs/LEARNINGS.md`, `docs/EXECUTION.md`

---

## Manna changes (behaviour different from upstream)

- **Default STT provider:** Manna defaults to `deepgram`; AssemblyAI is opt-in
- **Disconnect semantics:** upstream emits `stt_disconnected` on every Deepgram close (including silence-timeout auto-reconnects). Manna splits this — `stt_reconnecting` for transient drops, `stt_disconnected` only when terminal. UI keeps `isTranscribing = true` across reconnects.
- **Settings hydration:** parallelized via `Promise.all` (9 persisted keys loaded concurrently)
- **Auto-broadcast cooldown:** moved from module-level `let` to `useRef`, so multiple `TranscriptPanel` mounts don't share state
- **Broadcast history:** centralised into a `broadcast-store.addToHistory` action with dedup + 50-item cap; callers delegate instead of mutating directly

---

## What Manna removed

- Upstream's Vitest suites for `use-transcription`, `quick-search`, `bible-store`, `settings-store` (replaced incrementally as features were rewritten; not yet re-added — **TODO**)
- `src/lib/quick-search.ts` (functionality folded into the planner + command palette)
- `documentation/remote-control.md` (superseded by the settings-dialog Remote section)

---

## Credit

The hard parts — real-time audio capture, the detection ensemble, ONNX embedding pipeline, NDI output, theme designer, Bible data pipeline — are rhema's work. Manna sits on top and adds the church-livestream workflow, a second STT provider, and reliability improvements. Please star [openbezal/rhema](https://github.com/openbezal/rhema) too.
