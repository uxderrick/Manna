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

The Qwen3-Embedding-0.6B model export via `optimum-cli` failed with exit code 137 (OOM killed) on the user's Mac.

- The Bible database and all translations built successfully
- Semantic detection is disabled without the model but direct detection still works
- Solution: need a smaller model or pre-built download

## 7. rusqlite Version Matching

The `rhema-notes` crate needed `rusqlite 0.34` (not `0.35`) to match the existing `rhema-bible` crate. Cargo cannot link two different versions of the native `sqlite3` library in the same binary. Mismatched versions cause linker errors.

## 8. Tauri conf Changes Need Restart

Changes to `tauri.conf.json` (window title, product name, identifier) are **not** hot-reloadable. Requires a full app restart — the Vite HMR does not cover Tauri configuration.

## 9. nohup with Tauri

Running `nohup bun run tauri dev` can cause the Tauri window to not display properly on macOS. The window process detaches from the terminal session in a way that breaks the native window lifecycle.

**Better alternatives:**
- Run in foreground
- Use `& disown` instead of `nohup`
