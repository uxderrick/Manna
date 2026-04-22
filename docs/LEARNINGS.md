# Technical Learnings

## 1. react-resizable-panels v4 API

The exports changed from v3 to v4:

| v3 | v4 |
|---|---|
| `PanelGroup` | `Group` |
| `Panel` | `Panel` |
| `PanelResizeHandle` | `Separator` |

The `direction` prop became `orientation`.

Most importantly, `defaultSize`, `minSize`, and `maxSize` require **CSS unit strings** like `"22%"` — not bare numbers like `22`. Bare numbers fail to parse in the internal `ie()` function which expects units (`%`, `px`, `rem`, `em`, `vh`, `vw`). When parsing fails, the library falls back to auto-sizing which produces skewed `flex-grow` values and broken layouts.

## 2. localStorage Layout Caching

The library caches layouts in `localStorage` keyed by the `Group`'s `id` prop. Stale cached layouts override `defaultSize` values silently.

During development, either:

- Omit `id` entirely, or
- Change the `id` value when debugging sizing issues

This is a common source of "I changed the sizes but nothing happened" confusion.

## 3. Panel Card Styling Conflicts

The original Rhema panels had `rounded-lg border border-border bg-card` wrappers designed for standalone card layouts. When placed inside PanelTabs containers, these caused overflow and sizing issues.

**Fix:** Removed the card wrappers and added `min-w-0` for proper flex shrinking.

## 4. min-w-0 Is Critical in Flex Layouts

Without `min-w-0`, flex children won't shrink below their content's intrinsic width. This was causing the Detections panel to dominate and squeeze other panels.

Always add `min-w-0` to flex children that need to shrink proportionally.

## 5. Tauri API Errors in Browser

When viewing the Vite dev server (`localhost:3000`) in a regular browser instead of the Tauri webview, all `invoke()` and event listener calls fail with:

```
Cannot read properties of undefined
```

These errors only appear outside Tauri and are expected. The `__TAURI__` global is injected by the Tauri webview runtime and does not exist in regular browsers.

## 6. ONNX Model Export OOM

The Qwen3-Embedding-0.6B model export via `optimum-cli` failed with exit code 137 (OOM killed) on the user's Mac. The Python export process needs ~8-10GB RAM to hold the model and generate the ONNX graph.

**Solution:** Download pre-built ONNX files from HuggingFace instead of exporting locally. The `zhiqing/Qwen3-Embedding-0.6B-ONNX` repo has the correct feature-extraction export (no KV cache inputs).

## 7. Pre-built ONNX Model Gotchas

Not all pre-built ONNX exports are equal:

- **onnx-community/Qwen3-Embedding-0.6B-ONNX** — exported with KV cache inputs (`past_key_values.*`). Meant for text generation, not embeddings. Won't work for feature-extraction inference.
- **zhiqing/Qwen3-Embedding-0.6B-ONNX** — correct feature-extraction export, no KV cache. But outputs FP16 tensors, not FP32.
- **electroglyph/Qwen3-Embedding-0.6B-onnx-uint8** — also has KV cache.

**Always verify:** Check the model's input names. If you see `past_key_values.*` inputs, it's the wrong export for embeddings.

## 8. FP16 ONNX Model Output

Some ONNX exports output `Float16` tensors even when labeled as FP32. The Rust `ort` crate's `try_extract_tensor::<f32>()` will fail silently.

**Fix:** Try f32 first, fall back to f16 with conversion:

```rust
if let Ok((shape, d)) = value.try_extract_tensor::<f32>() { ... }
else if let Ok((shape, d)) = value.try_extract_tensor::<half::f16>() { ... }
```

Requires the `half` crate and `ort`'s `half` feature flag.

## 9. Embedding Precomputation Speed

Processing 31K Bible verses through embedding models:

| Approach | Model | Time |
|----------|-------|------|
| Rust single-verse | Qwen3 FP32 | ~5 hours (600ms/verse) |
| Python ONNX Runtime | Qwen3 FP32 | Crashed (OOM on model load) |
| Python sentence-transformers + MPS | Qwen3 | ~2.5 hours |
| Python sentence-transformers + CPU | MiniLM | ~5 minutes |

**Lesson:** For precomputation, use Python `sentence-transformers` with batch processing. The Rust ONNX embedder processes one verse at a time and is ~40x slower for bulk operations. The Rust embedder is fine for real-time single-query inference during sermons.

## 10. rusqlite Version Matching

The `rhema-notes` crate needed `rusqlite 0.34` (not `0.35`) to match the existing `rhema-bible` crate. Cargo cannot link two different versions of the native `sqlite3` library in the same binary. Mismatched versions cause linker errors.

## 11. Tauri conf Changes Need Restart

Changes to `tauri.conf.json` (window title, product name, identifier) are **not** hot-reloadable. Requires a full app restart — the Vite HMR does not cover Tauri configuration.

## 12. macOS Clipboard in Tauri Webview

Without a native Edit menu (`Undo`/`Redo`/`Cut`/`Copy`/`Paste`/`Select All`), Cmd+C/Cmd+V don't work in Tauri's webview on macOS. This is because macOS routes keyboard shortcuts through the native menu system.

**Fix:** Add `PredefinedMenuItem::cut/copy/paste/select_all/undo/redo` to the native Tauri menu in `menu.rs`. Even if you have a custom in-app menu bar, the native menu must include Edit items for clipboard to work.

## 13. Tailwind v4 @theme inline vs @theme

In Tailwind v4, variables defined in `@theme inline` are available for resolution but **do not generate utility classes**. Variables in a regular `@theme` block do generate utilities.

**Example:** `--font-serif` defined in `@theme inline` means `font-serif` class won't work. Moving it to a regular `@theme` block fixes it.

## 14. Semantic Detection Threshold Tuning

Different embedding models produce different similarity score ranges:

| Model | Recommended Threshold |
|-------|----------------------|
| Qwen3 (1024-dim) | 0.40-0.50 |
| MiniLM (384-dim) | 0.30-0.40 |

Too high = misses paraphrased verses. Too low = false positives on non-verse speech. Start at 0.40 and adjust based on testing.

## 15. nohup with Tauri

Running `nohup bun run tauri dev` can cause the Tauri window to not display properly on macOS. The window process detaches from the terminal session in a way that breaks the native window lifecycle.

**Better alternatives:**

- Run in foreground
- Use `& disown` instead of `nohup`

## 16. Deepgram Silence-Close vs Frontend "Ended" State

Deepgram closes WebSocket connections after ~10–12 s of silence. The backend handles this by reconnecting automatically (reset `attempts=0`, retry). But the backend emits `TranscriptEvent::Disconnected` → `stt_disconnected` to the frontend on every close.

If the frontend treats `stt_disconnected` as terminal (flipping `isTranscribing=false`), the UI renders the empty state on the detections panel (`detections.length === 0 && !isTranscribing`) even though the backend is alive and reconnecting.

**Fix:** `stt_disconnected` is a soft event — only clear the partial transcript and connection status, not `isTranscribing`. Re-assert `isTranscribing=true` on `stt_connected` so reconnects restore the UI. Only `stt_error` (max reconnect attempts, fatal) should flip `isTranscribing=false`.

## 17. Idempotent `start_transcription`

When the UI perceived a disconnect (see #16), users would click Start again. The backend's `stt_active=true` guard then returned "Transcription is already running" — stranding the user with a broken state.

**Fix:** Made `start_transcription` idempotent. If `stt_active=true`, re-emit `stt_connected` and return Ok instead of erroring. UI re-syncs with backend reality.

## 18. Deepgram Reconnect Loop After `stop_transcription`

`stop_transcription` sets `stt_active=false`, which drops the audio fanout thread. But the Deepgram client has its own `cancelled: Arc<AtomicBool>` flag that was never set — and combined with "reset attempts=0 on clean close" (intended for silence reconnects), the Deepgram outer loop would reconnect forever into a dead audio channel.

**Fix:** In the Deepgram reconnect loop, before retrying, trial-recv the audio channel. If `TryRecvError::Disconnected`, the audio source is gone — break out instead of reconnecting.

Long-term improvement: store a handle to the `SttProvider` in `AppState` so `stop_transcription` can call `provider.stop()` directly and set `cancelled=true` explicitly.

## 19. Tauri v2 `emitTo(label, ...)` Is Flaky for Rapid Updates

When updating a secondary window (e.g. broadcast output) via `emitTo("broadcast", ...)`, events get dropped or mis-routed under rapid-fire emission. Documented issues: [#11379](https://github.com/tauri-apps/tauri/issues/11379), [#11561](https://github.com/tauri-apps/tauri/issues/11561), [#9296](https://github.com/tauri-apps/tauri/issues/9296).

**Fix:** Switch to plain `emit("broadcast:verse-update:${outputId}", ...)` with a unique event name per output. Each window listens on its specific event name instead of relying on Tauri's label routing.

## 20. Deepgram Nova-3 Keyterms vs Keywords

Nova-3 uses **Keyterm Prompting** (multi-word phrases, plain strings). The older **Keywords** feature supported `word:N` intensifier syntax — **Keyterms do NOT**. If you pass `"Peter:3"` as a keyterm to Nova-3, the boost is ignored (or worse, treated as a literal string).

Keyterm limit: 500 tokens ≈ 100 keyterms per request. Order matters when you have more keyterms than the cap — put the highest-priority ones (commonly misheard bare names, translation abbreviations) first. Full phrases like "1 Peter" don't boost bare "Peter" — you need bare "Peter" as its own keyterm.

Sources: [Deepgram Keyterm docs](https://developers.deepgram.com/docs/keyterm), [Deepgram Keywords docs](https://developers.deepgram.com/docs/keywords).

## 21. Drain STT Event Channel After Stop

The transcript consumer task had two exit conditions:

```rust
while let Some(event) = event_rx.recv().await {
    if !evt_active.load(Ordering::SeqCst) { break; }   // ← premature
    match event { ... }
}
```

`stop_transcription` flips `stt_active=false` immediately, but the WebSocket receiver keeps running for 100–500 ms after that (reading buffered frames off the socket, parsing, forwarding to `event_tx`). With the early-break guard in place, those late-arriving `Turn` / `Final` events got dropped on the floor: users saw nothing on screen from short test sessions.

**Fix:** remove the flag check inside the loop. Let it drain until `event_rx.recv()` returns `None` (sender dropped when the provider task finally exits). The downstream `emit` calls are cheap even for a stopped UI — and the frontend's `stt_disconnected` handler already clears the partial.

**General rule:** if a producer and a stop-flag race, prefer letting the channel drain on sender-drop rather than having the consumer poll the flag. Polling the flag is almost always a bug that drops tail events.

## 22. UI "Started" State Should Follow Backend `Connected`, Not `invoke` Return

Previous pattern:

```tsx
await invoke("start_transcription", ...)
useTranscriptStore.getState().setTranscribing(true)   // ← too eager
```

`invoke("start_transcription")` returns as soon as the Rust command spawns the provider and audio tasks — **before** the WebSocket upgrade completes. On cold TLS/DNS that handshake takes 10–21 s. With the line above, the button immediately flips to "End Service" while the backend is still connecting. Users think it's live, click End, kill the session mid-handshake.

**Fix:** remove the local optimistic update. Let the backend's `stt_connected` event be the single source of truth — `transcript-panel.tsx` already listens and calls `setTranscribing(true)` on that event. The button correctly stays in "Connecting…" (disabled) until the WS upgrade succeeds.

**General rule:** for async backend handshakes, UI state transitions should be driven by the backend's "ready" event, not the return of the "start" invoke. The invoke return just means "I accepted the request."

## 23. Reqwest Rustls HTTP/2 Cold Start on macOS

The AssemblyAI key-verify `http_probe` was failing with an opaque `network: error sending request for url` on cold app starts, even though `curl` to the same endpoint worked fine. Root causes:

1. **6s `timeout` was too tight** for cold DNS + TLS handshake.
2. **No explicit `connect_timeout`** — reqwest defaults let DNS/TLS chew up the whole timeout budget.
3. **HTTP/2 negotiation via rustls** sometimes fails on the first request after a cold start (no shared ALPN cache, no session resumption). Subsequent requests work.
4. **Opaque error formatting** — `format!("{e}")` on a `reqwest::Error` doesn't include the error's `source()` chain, so the user sees "network: error sending request" with no hint at the root cause.

**Fix:**

```rust
let client = reqwest::Client::builder()
    .timeout(PROBE_TIMEOUT)                               // 15 s
    .connect_timeout(Duration::from_secs(10))
    .http1_only()                                         // sidestep rustls H2 cold-start
    .build()?;

// walk the error source() chain for useful detail
.map_err(|e| {
    use std::error::Error;
    let mut detail = format!("network: {e}");
    let mut src: Option<&dyn Error> = Error::source(&e);
    while let Some(s) = src {
        detail.push_str(&format!(" → {s}"));
        src = s.source();
    }
    detail
})?;
```

`http1_only()` is safe for a 6 KB JSON verification probe — HTTP/2 multiplexing buys nothing here. For production audio streaming use the default negotiation.

## 24. dotenvy Does Not Load `.env.local` by Default

`dotenvy::dotenv()` + `dotenvy::from_filename("../.env")` **do not** pick up `.env.local` — you have to list it explicitly:

```rust
dotenvy::dotenv().ok();
dotenvy::from_filename("../.env").ok();
dotenvy::from_filename("../.env.local").ok();   // required for Next.js-style conventions
```

Many devs (and AI assistants) assume `.env.local` is loaded automatically because Next.js / Vite / Create React App all do it. Rust's `dotenvy` does not.

## 25. `Arc<dyn Trait>` Over `Box<dyn Trait>` for Shared Lifecycle Handles

When a Tauri command spawns an async task that owns a trait object (e.g. `Box<dyn SttProvider>`) and a second command needs to reach that same object (e.g. `stop_transcription` calling `provider.stop()`), `Box` forces a choice: store the handle in state and never move it into the task, or move it into the task and lose access.

`Arc<dyn SttProvider>` solves both: clone the `Arc` into `AppState`, move a second clone into the task. Both sides see the same underlying provider; `.stop()` from the stop-command flips the provider's internal `cancelled` AtomicBool, which the async task observes.

The trait must be `Send + Sync` for `Arc<dyn T>` to cross threads — already true for `SttProvider` because async_trait requires it.

**Pattern:**

```rust
let provider: Arc<dyn SttProvider> = Arc::new(DeepgramClient::new(cfg));
app_state.stt_provider = Some(provider.clone());     // stop-command handle
tauri::async_runtime::spawn(async move {
    provider.start(audio_rx, event_tx).await;        // owns its own clone
});

// Later, from stop_transcription:
if let Some(provider) = app_state.stt_provider.take() {
    provider.stop();    // flips cancelled; task exits on next iteration
}
```

Direct cancellation is deterministic. Relying on downstream side-effects (e.g. drop fanout → drop audio channel → WS reader notices disconnected channel → exits) introduces timing windows where events get lost.

## 26. Prewarm TLS / Connection Pools at App Startup

On a cold app launch, the first HTTPS request to a new host pays 6–10s for DNS + TLS handshake (especially with `rustls` and HTTP/2 ALPN negotiation on macOS). If this first request is a user-initiated action like "verify API key," it looks broken.

Fix: spawn a background task on app startup that HEADs each host the app will later call. The response is discarded; the side effect is that DNS is cached, TLS session tickets are negotiated, and the connection pool has a keepalive slot ready.

```rust
tauri::async_runtime::spawn(async {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .connect_timeout(Duration::from_secs(5))
        .http1_only()
        .build().unwrap();
    for host in &["https://api.deepgram.com", "https://api.assemblyai.com"] {
        let _ = client.head(host).send().await;
    }
});
```

Silent failure is fine — warmup is best-effort. If a host is unreachable at launch, the user will see the real error later when they actually call it. Don't block app startup on this.

## 27. UI State Must Follow Backend Event, Not Local Optimism, for Long Handshakes

Covered in learning #22 as a bug fix. Generalizing: for any async operation where the backend's "accepted" signal is much earlier than "ready" (WebSocket handshakes, NDI streams, model loads), the UI must subscribe to the "ready" event and not mirror state locally on `invoke` return.

Common smell:

```tsx
await invoke("start_X")
store.setActive(true)   // ← lies if X takes >1s to actually start
```

Correct pattern:

```tsx
await invoke("start_X")
store.setStatus("connecting")   // accurate intermediate state

// elsewhere, backend emits "x_ready":
useTauriEvent("x_ready", () => store.setActive(true))
```

Test the state machine with a regression test that simulates the event sequence ([transcript-store.test.ts](../src/stores/transcript-store.test.ts)). Catches re-introduction of the local-optimism smell in PR review.

## 28. INT8 Quantization Is Near-Lossless for Embedding Models — But Verify the ONNX Export First

"FP32 is higher quality than INT8" is generation-model wisdom. For **embedding** models, INT8 dynamic quantization typically costs <1% MTEB — below benchmark noise. Qwen ships INT8 as the recommended deployment for their embedding family. Same for BGE, E5, and most MTEB-top models.

**2026-04-21 caveat**: this is only true if the INT8 file was quantized from the **feature-extraction** ONNX export, not the generation export. Manna learned this the hard way — upstream rhema's `model_quantized.onnx` was quantized from the generation export (KV-cache inputs), so running it as an embedder silently produced wrong vectors. Always inspect the ONNX graph before switching runtime precision:

```bash
python3 -c "import onnx; m = onnx.load('model.onnx', load_external_data=False);
  [print(i.name) for i in m.graph.input]"
```

Feature-extraction: `input_ids`, `attention_mask`, `position_ids` → `last_hidden_state`. Nothing else.
Generation: same 3 inputs + 56 `past_key_values.*` tensors → 56 `present.*` tensors + `logits`. Do **not** use this for embeddings.

**Cost model for embedding quantization:**

| Dtype | Quality delta | Disk | RAM (0.6B param model) |
|---|---|---|---|
| FP32 | baseline | 1.1 GB | ~1 GB |
| FP16 | <0.3% | 585 MB | ~600 MB |
| INT8 (dynamic, ARM64) | <1% | 585 MB | ~300 MB |

**Why embeddings quantize so well vs. generation:** embeddings output a single fixed-length vector via mean-pooling over token hidden states. Pooling averages away per-token quantization noise. Generation models compound quantization error across autoregressive steps — embeddings don't.

**Practical consequence:** the default model choice on desktop should be INT8, not FP32, unless you've benchmarked your specific retrieval task and measured a real gap. Manna ran FP32 for a week (2026-04-13 → 2026-04-20) because the original loader preferred "quality." That cost 700 MB RAM and 500 MB disk for zero measured benefit.

Precompute pipeline note: the DB-side embeddings file (`kjv-qwen3-0.6b.bin`) can be FP32 while the runtime query encoder is INT8 — the two dot-product together fine. No need to rebuild the embedding index when switching runtime precision.

## 29. Check Upstream Defaults Before Cargo-Culting Your Own

Manna forked rhema, changed the runtime model default from INT8 (upstream) to FP32 (fork) during initial setup. Reason: I assumed FP32 was "better" without benchmarking and without checking what upstream did. Took a week and a "low-spec hardware?" user question to catch.

Rule: when forking a working system, **diff your changes against upstream before assuming the delta is an improvement.** Upstream maintainers usually have a reason. If they picked INT8 over FP32, there's likely a constraint you haven't thought about yet (in this case: low-spec hardware + near-lossless quality).

Applies equally to: model quantization defaults, reconnect strategies, timeout values, keyterm counts, chunk sizes, confidence thresholds. All were tuned by upstream against real data. Don't silently override without evidence.

## 30. `bun run tauri -- <args>` Forwards `--` Literally

`bun run <script>` and `npm run <script>` differ on the `--` separator. npm strips the first `--` before invoking the script. Bun v1.3 forwards it literally into the script's argv.

Consequence: `bun run tauri build -- --config path` runs tauri-cli with `--config path` AFTER a `--`. Tauri's clap parser sees the `--` as "end of tauri options" and treats what follows as cargo flag passthrough — either fails (cargo doesn't know `--config`) or Tauri's fallback parser treats the value as inline TOML content.

Rule:

- Tauri-cli flags (`--config`, `--bundles`, `--features`) go BEFORE any `--`.
- Cargo flags (`--no-default-features`, `--release`) go AFTER a `--`.

Working CI invocation:

```bash
bun run tauri build --bundles nsis --config src-tauri/tauri.conf.minimal.json -- --no-default-features
```

References: [tauri#13252](https://github.com/tauri-apps/tauri/issues/13252), [bun#13984](https://github.com/oven-sh/bun/issues/13984).

## 31. GitHub `macos-14` Hosted Runners Cap MPS Allocations Regardless of RAM

GitHub Actions' hosted `macos-14` (Apple Silicon) runners advertise 7 GB RAM. In practice, PyTorch MPS backend OOMs around 1 GB — `PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0` has no effect because the cap is imposed by the hosted runtime layer, not PyTorch's own watermark logic. Confirmed by [actions/runner-images#9918](https://github.com/actions/runner-images/issues/9918).

Rule: **don't run GPU-heavy ML precompute on hosted macos runners.** Options:

1. Skip that job on CI; ship output as a committed artifact OR run locally + upload manually.
2. Use `macos-14-xlarge` paid runner (~$0.16/min) with real MPS.
3. Switch to `ubuntu-latest` with CPU torch — 16 GB RAM, 1.5–3 hr for 31K verses on CPU with `batch_size=32` + FP16, well under 6 hr timeout.

Manna chose option 1: `macos-full` flavor skipped on CI; local `setup:semantic` generates embeddings on user's own Mac.

## 32. `--no-default-features` Only Affects the Crate You're Building

In `src-tauri/Cargo.toml`:

```toml
rhema-detection = { path = "crates/detection", features = ["onnx"] }
```

…unconditionally requests `onnx` on `rhema-detection`, **regardless** of what features the `app` crate has enabled. `cargo build --no-default-features` on `app` disables `app`'s defaults but the explicit `features = ["onnx"]` on the dep still fires.

Fix: to make `onnx` truly toggleable, feature-gate it at both crate levels:

```toml
rhema-detection = { path = "crates/detection", default-features = false, features = ["vector-search"] }

[features]
default = ["whisper", "onnx"]
onnx = ["rhema-detection/onnx"]
```

Now `app`'s `onnx` feature enables `rhema-detection/onnx`. `--no-default-features` on `app` drops both.

Rule: **any transitive feature you might ever want to disable needs to be feature-gated at every crate boundary.** Otherwise `--no-default-features` only looks like it works — it won't disable deps requested with explicit `features = [...]` in the manifest.

Manna's Windows CI needed this to avoid a C++ CRT mismatch (`esaxx-rs` in tokenizers uses `/MT`, `whisper-rs-sys` uses `/MD` — LNK1319). Disabling `whisper` alone wasn't enough because `tokenizers` came in through `onnx`.

## 33. Tauri Signer: `--private-key` Takes Content, Not Path

Tauri v2's `tauri signer sign --private-key <VALUE>` expects the **raw base64 key content**, not a file path. Passing a file path causes `Invalid symbol 46, offset 0` — symbol 46 is ASCII `.`, which appears in any path with `.tauri-signing-key`.

Separate flag `-f/--private-key-path` takes a file path.

Canonical CI pattern: don't pass the key as a CLI arg at all. Set env vars:

- `TAURI_SIGNING_PRIVATE_KEY` — raw base64 key content
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — passphrase

Tauri signer picks them up automatically. Same pattern as `tauri-apps/tauri-action`. Subprocess inherits env vars from GitHub Actions secrets, no temp files.

Rule: when a CLI has both `--X` (content) and `--X-path` (file path) variants, prefer the env-var path for CI secrets.

## 34. Tauri MSI Bundler Rejects SemVer Pre-Release Tags

Tauri's Windows MSI bundler uses a 4-part numeric version (`X.Y.Z.W`). Pre-release tags like `0.1.0-rc1`, `0.1.0-beta.2` fail with:

```
optional pre-release identifier in app version must be numeric-only
and cannot be greater than 65535 for msi target
```

NSIS, DMG, AppImage all accept SemVer pre-releases. MSI is the outlier.

Rule: for pre-release CI (tags like `v*-rc*`), restrict to non-MSI bundles:

```bash
tauri build --bundles nsis  # Windows
tauri build --bundles dmg   # macOS
```

Or strip pre-release tag on Windows via pre-step rewriting `tauri.conf.json`. NSIS-only is simpler.

## 35. macOS 14 Removed the Right-Click Gatekeeper Bypass

Before macOS 14, users could right-click an unsigned app → "Open" → "Open Anyway" → launch. macOS 14 Sequoia removed that. Unsigned apps now show "Manna is damaged and can't be opened" with no bypass button.

The quarantine-removal trick still works but needs two commands:

```bash
xattr -dr com.apple.quarantine /Applications/Manna.app
codesign --force --deep --sign - /Applications/Manna.app
```

First strips the quarantine attribute. Second applies an ad-hoc self-signature (`-` = empty identity = local self-sign, no Apple cert needed). Together they satisfy Gatekeeper without Apple Developer Program membership.

Rule: for unsigned DMG distribution on macOS 14+, document BOTH commands in the install runbook. `xattr` alone is insufficient. Paid alternative: Apple Developer Program ($99/yr) → real signature + notarization → no warning.
