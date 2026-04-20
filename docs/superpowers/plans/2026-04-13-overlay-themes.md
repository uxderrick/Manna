# Custom Overlay Themes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix preview rendering to match broadcast output, add 4 new built-in themes inspired by real church designs, enhance the theme designer with dividers and line break modes, and persist custom themes to the database.

**Architecture:** Extend `BroadcastTheme` type with `divider` and `lineBreakMode` fields, update the `CanvasVerse` renderer to draw dividers and handle line breaking, add 4 new built-in themes, replace hardcoded monitors with `CanvasVerse`, add theme CRUD to the Rust database layer, and hydrate custom themes at startup.

**Tech Stack:** React 19, TypeScript, Canvas 2D API, Rust (rusqlite), Tauri commands, Zustand

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `src-tauri/src/commands/themes.rs` | Tauri commands for theme CRUD |

### Modified Files

| File | Changes |
|------|---------|
| `src/types/broadcast.ts` | Add `divider` and `lineBreakMode` to BroadcastTheme |
| `src/lib/verse-renderer.ts` | Add divider drawing and centered-lines mode |
| `src/lib/builtin-themes.ts` | Add 4 new built-in themes |
| `src/components/ui/canvas-verse.tsx` | No changes needed (already generic) |
| `src/components/broadcast/broadcast-monitor.tsx` | Replace hardcoded monitors with CanvasVerse |
| `src-tauri/crates/notes/src/db.rs` | Add themes table migration and CRUD methods |
| `src-tauri/src/commands/mod.rs` | Add `pub mod themes;` |
| `src-tauri/src/lib.rs` | Register theme commands |
| `src/stores/broadcast-store.ts` | Hydrate custom themes from DB at startup |

---

## Task 1: Extend BroadcastTheme Type

**Files:**
- Modify: `src/types/broadcast.ts`

- [x] **Step 1: Add divider and lineBreakMode to BroadcastTheme**

In `src/types/broadcast.ts`, add after the `reference` block (around line 87):

```typescript
  divider: {
    style: "none" | "line" | "dots"
    color: string
    width: number
    opacity: number
    dotCount: number
    dotSize: number
  }
```

And add to the `verseText` block (around line 55-68):

```typescript
  lineBreakMode: "flow" | "centered-lines"
```

- [x] **Step 2: Verify typecheck**

```bash
cd /Users/uxderrick-mac/Development/Manna && export PATH="$HOME/.bun/bin:$PATH"
bun run typecheck
```

Expected: Errors in files that construct BroadcastTheme without the new fields. That's expected — we'll fix them in subsequent tasks.

- [x] **Step 3: Commit**

```bash
git add src/types/broadcast.ts
git commit -m "feat: add divider and lineBreakMode to BroadcastTheme type"
```

---

## Task 2: Update Built-in Themes with New Fields

**Files:**
- Modify: `src/lib/builtin-themes.ts`

- [x] **Step 1: Add default divider and lineBreakMode to baseTheme**

In `builtin-themes.ts`, add to the `baseTheme` object:

```typescript
  divider: {
    style: "none" as const,
    color: "#ffffff",
    width: 40,
    opacity: 0.5,
    dotCount: 4,
    dotSize: 4,
  },
```

And add `lineBreakMode: "flow" as const` to the `verseText` block of each existing theme (CLASSIC_DARK, MODERN_LIGHT, BROADCAST_OVERLAY).

- [x] **Step 2: Add 4 new built-in themes**

Add after the existing themes:

**WARM_WORSHIP:**
```typescript
const WARM_WORSHIP: BroadcastTheme = {
  ...baseTheme,
  id: "builtin-warm-worship",
  name: "Warm Worship",
  background: {
    type: "gradient",
    color: "#e8451c",
    gradient: {
      type: "linear",
      angle: 135,
      stops: [
        { color: "#e8451c", position: 0 },
        { color: "#d4652e", position: 25 },
        { color: "#9b4dca", position: 70 },
        { color: "#6a3fa0", position: 100 },
      ],
    },
    image: null,
  },
  textBox: { enabled: false, color: "#000000", opacity: 0, borderRadius: 0, padding: 0 },
  verseText: {
    fontFamily: "Inter Variable",
    fontSize: 60,
    fontWeight: 600,
    color: "#ffffff",
    horizontalAlign: "center",
    verticalAlign: "middle",
    textTransform: "uppercase",
    textDecoration: "none",
    lineHeight: 1.9,
    letterSpacing: 3,
    shadow: { offsetX: 0, offsetY: 2, blur: 8, color: "rgba(0,0,0,0.3)" },
    outline: null,
    lineBreakMode: "centered-lines",
  },
  divider: { style: "line", color: "#ffffff", width: 40, opacity: 0.5, dotCount: 4, dotSize: 4 },
  reference: {
    fontFamily: "Inter Variable",
    fontSize: 36,
    fontWeight: 500,
    color: "rgba(255,255,255,0.8)",
    horizontalAlign: "center",
    verticalAlign: "top",
    textTransform: "none",
    textDecoration: "none",
    uppercase: true,
    letterSpacing: 4,
    position: "below",
  },
  layout: {
    anchor: "center",
    offsetX: 0, offsetY: 0,
    padding: { top: 80, right: 100, bottom: 80, left: 100 },
    textAlign: "center",
    backgroundWidth: 100, backgroundHeight: 100,
    textAreaWidth: 75, textAreaHeight: 80,
    referenceGap: 40,
  },
  transition: { type: "fade", duration: 500, easing: "ease-in-out", direction: "up" },
}
```

**PURE_MINIMAL:**
```typescript
const PURE_MINIMAL: BroadcastTheme = {
  ...baseTheme,
  id: "builtin-pure-minimal",
  name: "Pure Minimal",
  background: { type: "solid", color: "#000000", gradient: null, image: null },
  textBox: { enabled: false, color: "#000000", opacity: 0, borderRadius: 0, padding: 0 },
  verseText: {
    fontFamily: "Inter Variable",
    fontSize: 56,
    fontWeight: 400,
    color: "#ffffff",
    horizontalAlign: "center",
    verticalAlign: "middle",
    textTransform: "uppercase",
    textDecoration: "none",
    lineHeight: 2.2,
    letterSpacing: 3,
    shadow: null,
    outline: null,
    lineBreakMode: "centered-lines",
  },
  divider: { style: "dots", color: "#ffffff", width: 40, opacity: 1.0, dotCount: 4, dotSize: 4 },
  reference: {
    fontFamily: "Inter Variable",
    fontSize: 32,
    fontWeight: 400,
    color: "#ffffff",
    horizontalAlign: "center",
    verticalAlign: "top",
    textTransform: "none",
    textDecoration: "none",
    uppercase: true,
    letterSpacing: 5,
    position: "below",
  },
  layout: {
    anchor: "center",
    offsetX: 0, offsetY: 0,
    padding: { top: 100, right: 120, bottom: 100, left: 120 },
    textAlign: "center",
    backgroundWidth: 100, backgroundHeight: 100,
    textAreaWidth: 60, textAreaHeight: 70,
    referenceGap: 60,
  },
  transition: { type: "fade", duration: 500, easing: "ease-in-out", direction: "up" },
}
```

**WARM_DARK:**
```typescript
const WARM_DARK: BroadcastTheme = {
  ...baseTheme,
  id: "builtin-warm-dark",
  name: "Warm Dark",
  background: {
    type: "gradient",
    color: "#2d1b00",
    gradient: {
      type: "linear",
      angle: 180,
      stops: [
        { color: "#2d1b00", position: 0 },
        { color: "#1a0f00", position: 40 },
        { color: "#0a0500", position: 100 },
      ],
    },
    image: null,
  },
  textBox: { enabled: false, color: "#000000", opacity: 0, borderRadius: 0, padding: 0 },
  verseText: {
    fontFamily: "Source Serif 4 Variable",
    fontSize: 64,
    fontWeight: 400,
    color: "#e8d5b5",
    horizontalAlign: "center",
    verticalAlign: "middle",
    textTransform: "none",
    textDecoration: "none",
    lineHeight: 1.8,
    letterSpacing: 0,
    shadow: null,
    outline: null,
    lineBreakMode: "flow",
  },
  divider: { style: "line", color: "#d4a574", width: 40, opacity: 0.4, dotCount: 4, dotSize: 4 },
  reference: {
    fontFamily: "Inter Variable",
    fontSize: 36,
    fontWeight: 500,
    color: "#d4a574",
    horizontalAlign: "center",
    verticalAlign: "top",
    textTransform: "none",
    textDecoration: "none",
    uppercase: true,
    letterSpacing: 3,
    position: "below",
  },
  layout: {
    anchor: "center",
    offsetX: 0, offsetY: 0,
    padding: { top: 80, right: 100, bottom: 80, left: 100 },
    textAlign: "center",
    backgroundWidth: 100, backgroundHeight: 100,
    textAreaWidth: 70, textAreaHeight: 80,
    referenceGap: 40,
  },
  transition: { type: "fade", duration: 500, easing: "ease-in-out", direction: "up" },
}
```

**PURE_MINIMAL_LIGHT:**
```typescript
const PURE_MINIMAL_LIGHT: BroadcastTheme = {
  ...baseTheme,
  id: "builtin-pure-minimal-light",
  name: "Pure Minimal (Light)",
  background: { type: "solid", color: "#fafaf8", gradient: null, image: null },
  textBox: { enabled: false, color: "#000000", opacity: 0, borderRadius: 0, padding: 0 },
  verseText: {
    fontFamily: "Inter Variable",
    fontSize: 56,
    fontWeight: 400,
    color: "#1a1a1a",
    horizontalAlign: "center",
    verticalAlign: "middle",
    textTransform: "uppercase",
    textDecoration: "none",
    lineHeight: 2.2,
    letterSpacing: 3,
    shadow: null,
    outline: null,
    lineBreakMode: "centered-lines",
  },
  divider: { style: "dots", color: "#1a1a1a", width: 40, opacity: 1.0, dotCount: 4, dotSize: 4 },
  reference: {
    fontFamily: "Inter Variable",
    fontSize: 32,
    fontWeight: 400,
    color: "#1a1a1a",
    horizontalAlign: "center",
    verticalAlign: "top",
    textTransform: "none",
    textDecoration: "none",
    uppercase: true,
    letterSpacing: 5,
    position: "below",
  },
  layout: {
    anchor: "center",
    offsetX: 0, offsetY: 0,
    padding: { top: 100, right: 120, bottom: 100, left: 120 },
    textAlign: "center",
    backgroundWidth: 100, backgroundHeight: 100,
    textAreaWidth: 60, textAreaHeight: 70,
    referenceGap: 60,
  },
  transition: { type: "fade", duration: 500, easing: "ease-in-out", direction: "up" },
}
```

Update the `BUILTIN_THEMES` export to include all 7 themes.

- [x] **Step 3: Verify typecheck and commit**

```bash
bun run typecheck
git add src/lib/builtin-themes.ts
git commit -m "feat: add 4 new built-in themes — Warm Worship, Pure Minimal, Warm Dark, Pure Minimal Light"
```

---

## Task 3: Add Divider Rendering to Canvas

**Files:**
- Modify: `src/lib/verse-renderer.ts`

- [x] **Step 1: Add drawDivider function**

Add a new function `drawDivider` in `verse-renderer.ts` (before the main `renderVerse` function):

```typescript
function drawDivider(
  ctx: CanvasRenderingContext2D,
  divider: BroadcastTheme["divider"],
  centerX: number,
  y: number,
  scale: number
): number {
  if (divider.style === "none") return 0

  ctx.save()
  ctx.globalAlpha = divider.opacity

  const scaledWidth = divider.width * scale

  if (divider.style === "line") {
    ctx.strokeStyle = divider.color
    ctx.lineWidth = 1 * scale
    ctx.beginPath()
    ctx.moveTo(centerX - scaledWidth / 2, y)
    ctx.lineTo(centerX + scaledWidth / 2, y)
    ctx.stroke()
  } else if (divider.style === "dots") {
    ctx.fillStyle = divider.color
    const dotSize = divider.dotSize * scale
    const dotGap = 6 * scale
    const totalWidth = divider.dotCount * dotSize + (divider.dotCount - 1) * dotGap
    let dotX = centerX - totalWidth / 2
    for (let i = 0; i < divider.dotCount; i++) {
      ctx.beginPath()
      ctx.arc(dotX + dotSize / 2, y, dotSize / 2, 0, Math.PI * 2)
      ctx.fill()
      dotX += dotSize + dotGap
    }
  }

  ctx.restore()
  return 20 * scale // vertical space consumed by divider
}
```

- [x] **Step 2: Call drawDivider between verse text and reference**

In the `renderVerseImpl` function, after drawing the verse text and before drawing the reference, add the divider call. Find the section where `drawReference` is called and insert the divider drawing before it.

The divider should be drawn at the Y position between the verse text bottom and the reference top, using the `referenceGap` for spacing.

- [x] **Step 3: Add centered-lines support**

In the `drawVerseText` function, check `theme.verseText.lineBreakMode`. If it's `"centered-lines"`, break the text at commas, semicolons, colons, and periods (or every ~6-8 words if no punctuation), then center each line independently.

Add a helper function:

```typescript
function breakIntoCenteredLines(text: string): string[] {
  // Break at punctuation
  const parts = text.split(/([,;:.!?])\s*/g)
  const lines: string[] = []
  let current = ""

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (/^[,;:.!?]$/.test(part)) {
      current += part
      lines.push(current.trim())
      current = ""
    } else {
      // If no punctuation and line is getting long, break at ~6-8 words
      const words = part.trim().split(/\s+/)
      for (const word of words) {
        if (current.split(/\s+/).filter(Boolean).length >= 6) {
          lines.push(current.trim())
          current = ""
        }
        current += (current ? " " : "") + word
      }
    }
  }
  if (current.trim()) lines.push(current.trim())

  return lines.filter(Boolean)
}
```

When `lineBreakMode === "centered-lines"`, use this function instead of the normal word-wrapping algorithm.

- [x] **Step 4: Verify and commit**

```bash
bun run typecheck
git add src/lib/verse-renderer.ts
git commit -m "feat: canvas renderer supports dividers (line/dots) and centered-lines mode"
```

---

## Task 4: Replace Hardcoded Monitors with CanvasVerse

**Files:**
- Modify: `src/components/broadcast/broadcast-monitor.tsx`

- [x] **Step 1: Import CanvasVerse**

Add to imports:

```typescript
import { CanvasVerse } from "@/components/ui/canvas-verse"
```

- [x] **Step 2: Get active theme reactively**

The component already has `activeThemeId` and `themes`. Add:

```typescript
const activeTheme = themes.find((t) => t.id === activeThemeId) ?? themes[0]
```

- [x] **Step 3: Replace hardcoded On Screen monitor**

Replace the hardcoded gradient div for the On Screen monitor with:

```tsx
<div className={`overflow-hidden rounded ${isLive ? "ring-2 ring-destructive/40" : "ring-1 ring-white/[0.08]"}`}>
  <CanvasVerse
    theme={activeTheme}
    verse={liveVerse}
    className="w-full"
  />
</div>
```

- [x] **Step 4: Replace hardcoded Preview monitor**

Replace the hardcoded gradient div for the Preview monitor with:

```tsx
<div className="overflow-hidden rounded ring-1 ring-blue-500/15">
  <CanvasVerse
    theme={activeTheme}
    verse={previewVerse}
    className="w-full"
  />
</div>
```

- [x] **Step 5: Remove unused text rendering code**

Remove `previewText`, `liveText` variables and all the hardcoded inline styled divs that were rendering verse text.

- [x] **Step 6: Verify and commit**

```bash
bun run typecheck
git add src/components/broadcast/broadcast-monitor.tsx
git commit -m "feat: Preview and On Screen monitors use CanvasVerse — matches broadcast output"
```

---

## Task 5: Theme Persistence — Database Layer

**Files:**
- Modify: `src-tauri/crates/notes/src/db.rs`

- [x] **Step 1: Add themes table to migrations**

In the `migrate()` method, add after the existing tables:

```sql
CREATE TABLE IF NOT EXISTS themes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- [x] **Step 2: Add CRUD methods**

Add to `SessionDb`:

```rust
// ── Themes ────────────────────────────────────────────────

pub fn list_custom_themes(&self) -> Result<Vec<(String, String, String)>> {
    let mut stmt = self.conn.prepare(
        "SELECT id, name, data FROM themes ORDER BY updated_at DESC"
    )?;
    let themes = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(themes)
}

pub fn save_custom_theme(&self, id: &str, name: &str, data: &str) -> Result<()> {
    self.conn.execute(
        "INSERT INTO themes (id, name, data) VALUES (?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET name = ?2, data = ?3, updated_at = datetime('now')",
        params![id, name, data],
    )?;
    Ok(())
}

pub fn delete_custom_theme(&self, id: &str) -> Result<()> {
    self.conn.execute("DELETE FROM themes WHERE id = ?1", params![id])?;
    Ok(())
}
```

- [x] **Step 3: Verify and commit**

```bash
cd /Users/uxderrick-mac/Development/Manna/src-tauri && export PATH="$HOME/.cargo/bin:$PATH"
cargo check -p rhema-notes
cd .. && git add src-tauri/crates/notes/src/db.rs
git commit -m "feat: add themes table and CRUD to session database"
```

---

## Task 6: Theme Tauri Commands

**Files:**
- Create: `src-tauri/src/commands/themes.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [x] **Step 1: Create themes command file**

Create `src-tauri/src/commands/themes.rs`:

```rust
use rhema_notes::SessionDb;
use std::sync::Mutex;
use tauri::State;

type DbState = Mutex<SessionDb>;

#[tauri::command]
pub fn list_custom_themes(
    db: State<'_, DbState>,
) -> Result<Vec<(String, String, String)>, String> {
    db.lock()
        .unwrap()
        .list_custom_themes()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_custom_theme(
    db: State<'_, DbState>,
    id: String,
    name: String,
    theme_json: String,
) -> Result<(), String> {
    db.lock()
        .unwrap()
        .save_custom_theme(&id, &name, &theme_json)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_custom_theme(
    db: State<'_, DbState>,
    id: String,
) -> Result<(), String> {
    db.lock()
        .unwrap()
        .delete_custom_theme(&id)
        .map_err(|e| e.to_string())
}
```

- [x] **Step 2: Register module and commands**

In `src-tauri/src/commands/mod.rs`, add: `pub mod themes;`

In `src-tauri/src/lib.rs`, add to the `invoke_handler`:
```rust
commands::themes::list_custom_themes,
commands::themes::save_custom_theme,
commands::themes::delete_custom_theme,
```

- [x] **Step 3: Verify and commit**

```bash
cargo check --no-default-features
cd .. && git add src-tauri/src/commands/themes.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat: add Tauri commands for theme CRUD"
```

---

## Task 7: Hydrate Custom Themes on Startup

**Files:**
- Modify: `src/stores/broadcast-store.ts`

- [x] **Step 1: Add theme hydration**

Add a `hydrateCustomThemes` function that loads themes from the DB and merges them into the store:

```typescript
export async function hydrateCustomThemes(): Promise<void> {
  try {
    const rows = await invoke<Array<[string, string, string]>>("list_custom_themes")
    const customThemes: BroadcastTheme[] = rows.map(([_id, _name, json]) => {
      return JSON.parse(json) as BroadcastTheme
    })
    if (customThemes.length > 0) {
      const { themes } = useBroadcastStore.getState()
      const builtinIds = new Set(themes.filter(t => t.builtin).map(t => t.id))
      const merged = [
        ...themes.filter(t => t.builtin),
        ...customThemes.filter(t => !builtinIds.has(t.id)),
      ]
      useBroadcastStore.setState({ themes: merged })
    }
  } catch {
    console.warn("[themes] Failed to load custom themes")
  }
}
```

- [x] **Step 2: Update saveTheme and deleteTheme to persist**

Modify `saveTheme` to also call `save_custom_theme` for non-builtin themes:

```typescript
saveTheme: (theme) => {
  set((s) => ({
    themes: s.themes.some((t) => t.id === theme.id)
      ? s.themes.map((t) => (t.id === theme.id ? theme : t))
      : [...s.themes, theme],
  }))
  if (!theme.builtin) {
    invoke("save_custom_theme", {
      id: theme.id,
      name: theme.name,
      themeJson: JSON.stringify(theme),
    }).catch(() => {})
  }
},
```

Modify `deleteTheme` similarly:

```typescript
deleteTheme: (id) => {
  set((s) => ({ themes: s.themes.filter((t) => t.id !== id || t.builtin) }))
  invoke("delete_custom_theme", { id }).catch(() => {})
},
```

- [x] **Step 3: Call hydration at startup**

In the app's initialization (e.g., `src/main.tsx` or wherever `hydrateSettings` is called), add:

```typescript
import { hydrateCustomThemes } from "@/stores/broadcast-store"

// After other hydration calls:
hydrateCustomThemes()
```

- [x] **Step 4: Verify and commit**

```bash
bun run typecheck
git add src/stores/broadcast-store.ts src/main.tsx
git commit -m "feat: persist custom themes to DB and hydrate on startup"
```

---

## Task 8: Smoke Test

- [x] **Step 1: Restart the app**

```bash
pkill -f "target/debug/app"; pkill -f "tauri dev"; pkill -f "bun run tauri"; pkill -f "node.*vite"; lsof -ti:3000 | xargs kill -9
export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$PATH"
bun run tauri dev &
disown
```

- [x] **Step 2: Verify new themes appear in theme grid**

Check the broadcast panel — the theme selector grid should show 7 themes (3 original + 4 new). Each new theme should show its actual background and styling in the thumbnail.

- [x] **Step 3: Verify Preview/On Screen use CanvasVerse**

Select a verse, click Go Live. Both the Preview and On Screen monitors should render with the active theme — backgrounds, fonts, dividers, everything matching what goes to the projector.

- [x] **Step 4: Test theme switching**

Switch between themes in the grid. The monitors should update immediately with the new theme's styling.

- [x] **Step 5: Test divider rendering**

Select "Pure Minimal" theme — should show 4 white dots between verse and reference. Select "Warm Worship" — should show a thin white line divider.

- [x] **Step 6: Test centered-lines mode**

With "Pure Minimal" theme active and a verse displayed — the text should break into short centered lines (one phrase per line), not flow as a paragraph.

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Extend BroadcastTheme type (divider, lineBreakMode) |
| 2 | Add 4 new built-in themes + update existing with new fields |
| 3 | Canvas renderer: divider drawing + centered-lines |
| 4 | Replace hardcoded monitors with CanvasVerse |
| 5 | Theme persistence — database layer |
| 6 | Theme Tauri commands |
| 7 | Hydrate custom themes on startup |
| 8 | Smoke test |
