# Custom Overlay Themes — Design Spec

**Date:** 2026-04-13
**Wave:** 2, Feature 5
**Scope:** Fix preview rendering, add 4 new built-in themes, enhance theme designer, persist custom themes

---

## Part A: Fix Preview/Program Rendering

### Problem

The Preview and On Screen monitors in the broadcast panel render verse text with hardcoded inline styles (gradient backgrounds, fixed fonts). The actual broadcast window uses `CanvasVerse` — a canvas-based renderer that reads the full `BroadcastTheme`. What you see in the monitors doesn't match what goes to the projector.

### Fix

- Replace hardcoded gradient divs in `BroadcastMonitor` with the actual `CanvasVerse` component
- Render at the theme's native resolution (1920×1080), scale down to fit the monitor thumbnail via CSS `transform: scale()`
- Both Preview and On Screen monitors show exactly what goes to the projector
- When the active theme changes, monitors update immediately
- The `CanvasVerse` component already exists at `src/components/ui/canvas-verse.tsx`

---

## Part B: Four New Built-in Themes

### Theme A: Warm Worship

| Property | Value |
|----------|-------|
| **Background** | Linear gradient 135deg: #e8451c → #d4652e → #9b4dca → #6a3fa0 |
| **Verse text** | Sans-serif (Inter), white, uppercase, letter-spacing 3px, centered, text-shadow (0 2px 8px rgba(0,0,0,0.3)) |
| **Divider** | Thin white line, 40px wide, 50% opacity |
| **Reference** | Sans-serif, white 80% opacity, uppercase, letter-spacing 4px, below divider |
| **Line break mode** | Centered lines (one phrase per line) |
| **Use case** | Praise & worship services, vibrant/energetic feel |

### Theme C: Pure Minimal

| Property | Value |
|----------|-------|
| **Background** | Solid black #000000 |
| **Verse text** | Sans-serif (Inter), white, uppercase, letter-spacing 3px, centered, line-height 2.2, short centered lines |
| **Divider** | 4 white dots in a row, spaced 6px |
| **Reference** | Sans-serif, white, uppercase, letter-spacing 5px, at very bottom |
| **Line break mode** | Centered lines |
| **Use case** | Elegant, quiet, lets the Word speak. Evening services, prayer meetings |

### Theme D: Warm Dark

| Property | Value |
|----------|-------|
| **Background** | Linear gradient 180deg: #2d1b00 → #1a0f00 → #0a0500 |
| **Verse text** | Serif (Source Serif 4), warm cream #e8d5b5, normal case, centered, line-height 1.8 |
| **Divider** | Thin gold line, 40px wide, 40% opacity, color #d4a574 |
| **Reference** | Sans-serif, gold #d4a574, uppercase, letter-spacing 3px, below divider |
| **Line break mode** | Flow (paragraph) |
| **Use case** | Intimate, reverent. Candlelight services, communion |

### Theme F: Pure Minimal (Light)

| Property | Value |
|----------|-------|
| **Background** | Solid off-white #fafaf8 |
| **Verse text** | Sans-serif (Inter), dark #1a1a1a, uppercase, letter-spacing 3px, centered, line-height 2.2, short centered lines |
| **Divider** | 4 dark dots in a row, spaced 6px |
| **Reference** | Sans-serif, dark #1a1a1a, uppercase, letter-spacing 5px, at bottom |
| **Line break mode** | Centered lines |
| **Use case** | Bright rooms, daytime services, well-lit environments |

---

## Part C: Theme Designer Enhancements

### New Controls

| Control | Description | Values |
|---------|-------------|--------|
| **Text divider style** | Separator between verse text and reference | None / Line / Dots / Custom |
| **Divider color** | Color of the divider | Color picker, default: theme reference color |
| **Divider width** | Width of line or dot group | 20px–100px slider |
| **Divider opacity** | Transparency of divider | 0–100% slider |
| **Letter-spacing** | Spacing between characters | 0px–8px slider, for verse and reference independently |
| **Line break mode** | How verse text wraps | "Flow" (natural paragraph) / "Centered lines" (breaks at commas, semicolons, or every ~6-8 words) |
| **Text transform** | Case transformation | None / Uppercase / Capitalize |
| **Custom font upload** | Add custom font files | .woff2 / .ttf upload, appears in font picker |
| **Image background** | Upload background image | Upload image, fit/cover/tile, blur, brightness, tint overlay |

### Theme Management

| Action | Interaction |
|--------|------------|
| **Create new** | "+" button in theme grid → opens designer with blank theme |
| **Edit existing** | Click theme card → opens designer with theme loaded |
| **Duplicate** | Right-click or menu → "Duplicate" |
| **Delete** | X button on custom themes (built-in themes cannot be deleted) |
| **Export** | Download as .json file to share with other Manna installations |
| **Import** | Drop a .json file to add a theme |

### Data Model Changes

Add to `BroadcastTheme` type:

```typescript
// New fields on BroadcastTheme
divider: {
  style: "none" | "line" | "dots"
  color: string
  width: number        // px
  opacity: number      // 0-1
  dotCount: number     // for dots style, default 4
  dotSize: number      // px, default 4
}

// New field on verseText
lineBreakMode: "flow" | "centered-lines"

// letterSpacing already exists on verseText and reference
// textTransform already exists on verseText
```

---

## Part D: Theme Persistence

### Database

New table in `manna.db`:

```sql
CREATE TABLE IF NOT EXISTS themes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

`data` column stores the full `BroadcastTheme` serialized as JSON.

### Rust (rhema-notes crate)

Add to `SessionDb`:
- `list_custom_themes() -> Vec<(String, String, String)>` (id, name, json)
- `save_custom_theme(id, name, json) -> Result<()>`
- `delete_custom_theme(id) -> Result<()>`

### Tauri Commands

- `list_custom_themes()` → returns saved themes from DB
- `save_custom_theme(id, name, theme_json)` → upserts to DB
- `delete_custom_theme(id)` → removes from DB

### Frontend Lifecycle

1. **App startup:** Load built-in themes + `list_custom_themes()` from DB → merge into Zustand `themes` array
2. **Save/edit custom theme:** Update store + `save_custom_theme()` to DB
3. **Delete custom theme:** Remove from store + `delete_custom_theme()` from DB
4. **Export:** Serialize theme from store to JSON, trigger file download
5. **Import:** Parse uploaded JSON, validate structure, `save_custom_theme()` to DB + add to store

---

## Implementation Order

1. Add `divider` and `lineBreakMode` to `BroadcastTheme` type
2. Update `CanvasVerse` renderer to support dividers and line break modes
3. Add 4 new built-in themes to `builtin-themes.ts`
4. Replace hardcoded monitors in `BroadcastMonitor` with `CanvasVerse`
5. Add theme persistence (DB table, Rust CRUD, Tauri commands)
6. Update theme designer with new controls (divider, letter-spacing, line break mode)
7. Add theme import/export
8. Add custom font upload support
9. Add image background support
