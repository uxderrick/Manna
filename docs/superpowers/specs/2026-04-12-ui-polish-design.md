# Manna UI Polish — Design Spec

**Date:** 2026-04-12
**Scope:** Visual polish of the Wave 1 workspace layout — colors, typography, tabs, cards, broadcast preview/program, dark mode

---

## Aesthetic Direction: Soft & Inviting

A warm, approachable design for church production teams. Feels like a well-crafted Bible app crossed with a broadcast control tool — not a developer IDE.

### Color Palette

**Light Mode:**
| Token | Value | Usage |
|-------|-------|-------|
| `--background` | `#f6f3ef` (warm cream) | Page background |
| `--card` | `#faf8f5` (off-white) | Panel backgrounds |
| `--card-elevated` | `#ffffff` | Detection cards, queue items |
| `--muted` | `#f0ece6` (warm gray) | Tab bar backgrounds, menu bar |
| `--border` | `#e8e3dc` (warm border) | All borders |
| `--primary` | `#3d6b4f` (forest green) | Active tabs, buttons, accents |
| `--primary-foreground` | `#ffffff` | Text on primary |
| `--foreground` | `#2c2c2c` | Primary text |
| `--muted-foreground` | `#8b7e6e` (warm gray) | Secondary text, labels |
| `--faded` | `#b5a99a` | Timestamps, tertiary text |

**Dark Mode:**
| Token | Value | Usage |
|-------|-------|-------|
| `--background` | `#161514` (warm black) | Page background |
| `--card` | `#1c1b19` (dark warm) | Panel backgrounds |
| `--card-elevated` | `rgba(255,255,255,0.03)` | Detection cards, queue items |
| `--muted` | `rgba(255,255,255,0.02)` | Tab bar backgrounds |
| `--border` | `rgba(255,255,255,0.06)` | All borders |
| `--primary` | `#3d6b4f` (forest green) | Active tabs, buttons |
| `--primary-light` | `#6fbf8a` | Text accents in dark mode |
| `--foreground` | `rgba(255,255,255,0.9)` | Primary text |
| `--muted-foreground` | `rgba(255,255,255,0.4)` | Secondary text |
| `--faded` | `rgba(255,255,255,0.25)` | Timestamps |

### Typography

| Element | Font | Size | Weight | Notes |
|---------|------|------|--------|-------|
| Scripture text | Georgia, serif | 13px | 400 | Verse content in search, detections, queue |
| Verse reference | Inter (sans) | 12-13px | 600 | e.g., "Romans 8:28" |
| Verse numbers | Inter (sans) | 9px | 700 | Superscript, primary color |
| Chapter headings | Georgia, serif | 13px | 600 | e.g., "Leviticus 1", primary color |
| Panel section labels | Inter (sans) | 11px | 600 | Uppercase, letter-spacing: 1px, muted-foreground |
| Tab labels | Inter (sans) | 11px | 500 | Inside pill tabs |
| Menu bar | Inter (sans) | 12px | 400 | Menu item text |
| Toolbar session title | Inter (sans) | 12px | 600 | Active session name |
| Toolbar timer | Monospace | 11px | 400 | tabular-nums, muted |
| Status badges | Inter (sans) | 10px | 600 | LIVE badge, source badges |
| Buttons | Inter (sans) | 11px | 500 | Present, Queue, TAKE |

### Tab Style

Pill-shaped tabs replacing the current underline tabs:

- **Active tab:** `background: primary`, `color: white`, `border-radius: 14px`, `padding: 3px 10px`
- **Inactive tab:** `background: transparent`, `color: muted-foreground`, same padding
- **Hover:** `background: primary/8%`, `color: primary`
- **Tab bar background:** `muted` color, `border-bottom: 1px solid border`
- **Gap between tabs:** `4px`

### Cards (Detection Cards, Queue Items)

- **Background:** `card-elevated` (white in light, subtle in dark)
- **Border:** `1px solid border`
- **Border radius:** `10px` (rounded-xl equivalent)
- **Padding:** `12px`
- **Gap between cards:** `6px`
- **No left accent borders** — clean flat cards
- **Active queue item:** `background: primary`, `color: white`, `border: none`

### Source Badges

- **Direct:** green dot + green badge (`rgba(16,185,129,0.1)` bg, `#059669` text)
- **Semantic:** indigo dot + indigo badge (`rgba(99,102,241,0.1)` bg, `#4f46e5` text light / `#818cf8` dark)
- **Low confidence:** amber dot + amber badge, card at `opacity: 0.6`
- **Badge style:** `border-radius: 8px`, `padding: 1px 7px`, `font-size: 9px`, `font-weight: 600`, `text-transform: uppercase`

### Buttons

- **Primary (Present, TAKE):** `background: primary`, `color: white`, `border-radius: 14px`, `padding: 3px 12px`, `font-size: 11px`
- **Secondary (Queue, Off Air):** `background: transparent`, `border: 1px solid primary`, `color: primary`, same shape
- **Destructive (Off Air when live):** `background: rgba(239,68,68,0.12)`, `border: 1px solid rgba(239,68,68,0.25)`, `color: #ef4444`

---

## Layout Change: Broadcast Preview/Program

### Current State
Broadcast Preview is a tab in the center panel — hidden when Detections tab is active.

### New Layout
Right panel splits into two sections:
1. **Top:** Queue/Cross-refs/Plan tabs (scrollable list)
2. **Bottom:** Always-visible Preview + Program monitors (stacked vertically)

### Preview/Program Section

Dark background (even in light mode — it represents the broadcast output).

**Preview (top monitor):**
- Label: "PREVIEW — NEXT" in uppercase, muted text
- TAKE button inline with label: red background, white text, "TAKE →"
- 16:9 aspect ratio thumbnail showing the next verse rendered with active theme
- Border: `1px solid rgba(255,255,255,0.08)`

**Program (bottom monitor):**
- Label: red dot (pulsing) + "PROGRAM — LIVE" in red text
- OFF AIR button inline with label
- 16:9 aspect ratio thumbnail showing current live output
- Border: `2px solid rgba(239,68,68,0.3)` (red tint to indicate live)

**Controls row below both monitors:**
- Prev / Next buttons, compact, ghost style

### Workflow
1. Verse selected from queue or detection → appears in **Preview**
2. User confirms it looks right → clicks **TAKE** → moves to **Program** (goes live via NDI)
3. **Off Air** clears the program output

### Center Panel Tab Update
Remove "Broadcast Preview" tab from center panel. Center tabs become: Detections, Analytics.

---

## Component Changes

### 1. index.css — Color Token Overhaul
Replace current OKLCH tokens with the warm palette defined above. Both `:root` (light) and `.dark` (dark) blocks.

### 2. panel-tabs.tsx — Pill Tabs
Replace border-bottom underline tabs with filled pill tabs. Active state uses primary color fill.

### 3. panel-header.tsx — Readable Headers
- Increase text size from `text-[0.6875rem]` (11px) to `text-xs` (12px)
- Keep uppercase + letter-spacing
- Remove the dark-mode-only inset shadow

### 4. workspace.tsx — Layout Restructure
- Remove "Broadcast Preview" from center panel tabs
- Split right panel into vertical Group: Queue tabs (top) + Preview/Program (bottom, always visible)
- Preview/Program section is a new component

### 5. New: broadcast-monitor.tsx
New component for the Preview/Program section:
- Two 16:9 canvases stacked vertically
- Preview shows next queued verse rendered with active theme
- Program shows current live verse
- TAKE button pushes preview → program
- Off Air clears program
- Prev/Next controls

### 6. toolbar.tsx — Badge Size Fix
- Status badge from `text-[0.5rem]` to `text-[0.625rem]` (10px)

### 7. menu-bar.tsx — Warm Colors
- Background: `bg-muted` instead of `bg-card/80`
- "Manna" label in primary color

### 8. Detection cards — Clean Style
- Remove any remaining card borders that feel heavy
- Use the warm card-elevated background
- Rounded-xl (10px radius)
- Pill-shaped action buttons

### 9. Queue panel — Active Item Styling
- Active item: primary color background, white text, "ON AIR" label
- Queued items: card-elevated background, normal text

### 10. Search panel — Warm Tones
- Selected verse: subtle primary/5% background highlight, no left border
- Verse numbers in primary color, superscript

---

## Dark Mode Strategy

Both modes are first-class. Follow OS preference via the existing theme-provider.

Key principle: dark mode uses **warm** dark tones (`#161514`, `#1c1b19`) not cold blue-blacks. The forest-green primary lightens slightly to `#6fbf8a` for readability in dark mode.

The broadcast monitor section (Preview/Program) is always dark regardless of app theme — it represents the broadcast output.
