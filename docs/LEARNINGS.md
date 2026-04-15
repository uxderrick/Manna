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
