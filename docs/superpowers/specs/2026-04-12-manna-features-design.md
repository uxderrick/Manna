# Manna — Feature Design Spec

**Date:** 2026-04-12
**Project:** Manna (forked from openbezal/rhema, MIT license)
**Purpose:** Real-time AI-powered Bible verse detection for live sermons, enhanced with sermon workflow tools for church use.

---

## Overview

Manna extends Rhema with 10 new features organized in 3 waves (Infrastructure → Core → Integration), plus a full UI revamp aligned with the design DNA from comms360-v2 and complianceOS.

### Implementation Approach: Infrastructure First (Approach B)

**Wave 1 — Foundation:** UI revamp + sermon session model
**Wave 2 — Core Features:** Sermon notes, planner, analytics, cross-refs, custom themes
**Wave 3 — Integration Features:** Post-sermon distribution, remote control, worship songs, announcements

### Backlog (future releases)
- Congregation follow-along mode (passive sermon takeaway tool, not a live distraction)
- Multi-speaker support
- Pastor's dashboard (pre/post service review)
- Sermon series/campaign manager
- Prayer request integration
- Multilingual live toggle (per-user translation choice)
- Cloud hosting (thin client + cloud hybrid for low-spec devices)
- Remote control web UI redesign

---

## 1. Sermon Session Model (Foundation)

The core data model that almost every feature depends on. Currently Rhema has no concept of a "sermon" — sessions are ephemeral and lost when the app closes.

### Database Schema

Separate `manna.db` alongside the existing `rhema.db`:

```sql
-- Sermon sessions
CREATE TABLE sermon_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  speaker TEXT,
  date TEXT NOT NULL,
  series_name TEXT,
  tags TEXT,                    -- JSON array
  started_at TEXT,
  ended_at TEXT,
  status TEXT NOT NULL DEFAULT 'planned',  -- planned | live | completed
  planned_scriptures TEXT,     -- JSON array of {verse_ref, translation, order}
  summary TEXT,                -- auto-generated post-sermon
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Verse detections anchored to a session
CREATE TABLE session_detections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sermon_sessions(id),
  verse_ref TEXT NOT NULL,
  verse_text TEXT NOT NULL,
  translation TEXT NOT NULL,
  confidence REAL NOT NULL,
  source TEXT NOT NULL,         -- direct | semantic_local | semantic_cloud | quotation
  detected_at TEXT NOT NULL,
  was_presented INTEGER DEFAULT 0,
  transcript_snippet TEXT
);
CREATE INDEX idx_session_detections_session ON session_detections(session_id);

-- Full transcript segments
CREATE TABLE session_transcript (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sermon_sessions(id),
  text TEXT NOT NULL,
  is_final INTEGER DEFAULT 1,
  confidence REAL,
  timestamp_ms INTEGER NOT NULL,
  speaker_label TEXT
);
CREATE INDEX idx_session_transcript_session ON session_transcript(session_id);

-- Sermon notes (auto + manual)
CREATE TABLE session_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sermon_sessions(id),
  type TEXT NOT NULL DEFAULT 'manual',  -- auto_summary | manual | annotation
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_session_notes_session ON session_notes(session_id);

-- Distribution history
CREATE TABLE session_distributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sermon_sessions(id),
  channel TEXT NOT NULL,       -- email | whatsapp | webhook
  recipient TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent'  -- sent | failed | pending
);
CREATE INDEX idx_session_distributions_session ON session_distributions(session_id);
```

### Rust Implementation

Expand the existing empty `rhema-notes` crate into `manna-sessions`:
- Own `manna.db` connection (separate from Bible DB)
- CRUD for all session tables
- Auto-migration on app startup
- Session lifecycle: create → start → end → summarize

### Frontend

New `session-store.ts` (Zustand):
- `activeSession: SermonSession | null`
- Actions: `createSession()`, `startSession()`, `endSession()`, `addDetection()`, `addTranscript()`, `addNote()`
- On session start: begin recording all detections and transcript segments
- On session end: trigger auto-summary generation

### Session Lifecycle

1. **Pre-service:** Create session (manual or from planner), set title/speaker/date
2. **Start:** Session goes `live`, transcript and detections begin recording
3. **During:** All verse detections, transcript segments, and queue actions are persisted
4. **End:** Session goes `completed`, auto-generate summary from detection timeline
5. **Review:** Edit summary, add notes, export, distribute

---

## 2. UI Revamp

### Design System Alignment

Adopt design DNA from comms360-v2 and complianceOS:

| Token | Value |
|-------|-------|
| **Color space** | OKLCH with CSS custom properties |
| **Primary** | oklch(0.55 0.18 260) |
| **Primitives** | Radix UI |
| **Variants** | CVA (class-variance-authority) |
| **Composition** | Slot-based (Root/Header/Title/Content/Footer) |
| **Icons** | Phosphor Icons |
| **Toasts** | Sonner, top-right |
| **Drawers** | Vaul, backdrop blur, spring easing |
| **Typography** | Universal Sans Display (display) + Inter (body) |
| **Font features** | cv02, cv03, cv04, cv11 |
| **Buttons** | 6 modes (filled/light/outline/ghost/raised/link), rounded-full |
| **Cards** | rounded-2xl, slot composition |
| **Easing** | Spring: cubic-bezier(0.34, 1.56, 0.64, 1) |
| **Durations** | 150ms / 200ms / 300ms / 500ms |
| **Dark mode** | Full OKLCH overrides, theme-provider |
| **Accessibility** | prefers-reduced-motion, ARIA, focus rings |
| **Data attrs** | data-slot, data-state, data-active |

### Layout: Desktop Workspace

This is a native desktop app, not a web dashboard. The layout should feel like a professional workspace tool (Figma, OBS, Linear).

```
┌─────────────────────────────────────────────────────────────────┐
│ Manna │ Session │ Broadcast │ View │ Help                       │  Menu bar (~28px)
├─────────────────────────────────────────────────────────────────┤
│ [● Live 00:14:32]  ▊▊▊▊░░  [settings] [dark mode]             │  Toolbar (~40px)
├──────────────┬────────────────────────┬─────────────────────────┤
│              │                        │                         │
│  LEFT PANEL  │  CENTER PANEL          │  RIGHT PANEL            │
│  (Context)   │  (Primary Focus)       │  (Action)               │
│              │                        │                         │
│  Tabs:       │  Tabs:                 │  Tabs:                  │
│  • Script    │  • Detections          │  • Queue                │
│  • Search    │  • Broadcast Preview   │  • Cross-refs           │
│  • Notes     │  • Theme Designer      │  • Planner              │
│  • Songs     │  • Analytics           │                         │
│              │                        │                         │
├──────────────┴────────────────────────┤                         │
│  BOTTOM BAR (collapsible)             │                         │
│  Live Transcript ▼                    │                         │
└───────────────────────────────────────┴─────────────────────────┘
```

#### Menu Bar (~28px)

Custom in-app menu bar styled with design DNA (not Tauri native, for full control):

| Menu | Items |
|------|-------|
| **Manna** | About, Check for Updates, Preferences, Quit |
| **Session** | New Session, End Session, Import Plan, Export Notes, Distribute Summary |
| **Broadcast** | Go Live, Go Off Air, New Announcement, Switch Theme ▸, Open Theme Designer |
| **View** | Toggle Transcript Bar, Reset Panel Layout, Toggle Dark Mode, Zoom In/Out |
| **Help** | Tutorial, Keyboard Shortcuts, Documentation, Report Issue |

Keyboard shortcuts for power users (Cmd+Shift+N for new announcement, etc.).

#### Toolbar (~40px)

Compact bar with:
- App icon + "Manna" label
- Session controls: start/stop button, live timer, speaker name
- Audio level meter + live indicator
- Quick actions: settings gear, dark/light mode toggle

#### Panel System

Three resizable panels (react-resizable-panels) with tab navigation within each:

**Left Panel (Context/Input):**
- **Script tab:** Sermon notes being auto-captured, manual annotation input
- **Search tab:** Bible search (FTS5) + semantic search
- **Notes tab:** Manual notes editor
- **Songs tab:** Song library browser

**Center Panel (Primary Focus):**
- **Detections tab:** AI-detected verses flowing in real-time, source badges (Direct=green, Semantic=indigo), confidence dots, "Present" and "Queue" actions
- **Broadcast Preview tab:** Live preview of current broadcast output with active theme
- **Theme Designer tab:** Full theme editor (background, text, layout properties)
- **Analytics tab:** Verse history, frequency charts, session archive

**Right Panel (Action/Output):**
- **Queue tab:** Verse queue with drag-and-drop reordering, present/remove controls
- **Cross-refs tab:** Auto-populated cross-references for the selected verse
- **Planner tab:** Sermon scripture sequence for the current session

**Bottom Bar (Collapsible):**
- Live transcript stream — always accessible, collapsible like an IDE terminal
- Expands upward when clicked/needed
- Shows partial and final transcript segments with timestamps

#### Live Sermon Default View

During a live service, the default tab configuration:
- Left: Notes (auto-capturing)
- Center: Detections (verses flowing in)
- Right: Queue (what's going to broadcast)
- Bottom: Transcript (collapsed, peek when needed)

#### Pre-Service Setup View

- Left: Search (find verses to pre-load)
- Center: Theme Designer (set up overlays)
- Right: Planner (build sermon sequence)

---

## 3. Sermon Planner

Pre-load the scripture sequence before service.

### Location
Right panel → Planner tab

### Features
- Create a plan: title, speaker, date, series (optional)
- Add scriptures in order: search by reference or keyword, drag-and-drop reorder
- Each item shows: verse reference, preview text, translation
- One-click "Load to Queue" pushes entire plan into the live queue when service starts
- Visual distinction: planned verses (solid badge) vs. detected verses (outline badge)

### Data
Stored in `sermon_sessions.planned_scriptures` JSON field with `status: planned` until session goes live.

### Post-Sermon Comparison
Analytics shows planned vs. actually preached — which planned verses were used, which were skipped, which unplanned verses were detected.

---

## 4. Sermon Notes & Export

### Auto-Capture
- Every detected verse, transcript segment, and queue action logged in real-time to `session_detections` and `session_transcript`
- On session end: auto-generate structured summary from detection timeline (no cloud AI — formatted from captured data)

### Notes Tab (Left Panel)
- **During sermon:** Auto-populated timeline view — timestamps + detected verses + transcript snippets
- **Manual annotations:** Tech team can add notes (e.g., "Pastor emphasized this verse")
- **Post-sermon:** Editable rich-text summary

### Export Formats
- **PDF** — branded sermon recap with church logo, verse list, cross-references, timestamps
- **Markdown** — for sharing in docs/notes apps
- **JSON** — structured data for integrations
- **Clipboard** — quick copy of verse list

### Export Access
From History page (past sessions) or end-of-session review screen.

---

## 5. Custom Overlay Themes

### Enhancements to Existing Theme Designer
- **Custom font uploads** — load .woff2/.ttf files, available in font picker
- **Image background library** — upload and manage backgrounds (church logo, textures), stored locally in app data
- **Theme presets by category** — "Minimal", "Traditional", "Modern", "Holiday" groupings
- **Import/export themes** — share .json theme files between Manna installations
- **Live preview with actual verse** — pick any verse to preview, not just placeholder text

### What Stays
- Existing theme structure (resolution, background, text styling, layout anchoring)
- Canvas-based rendering pipeline → NDI output
- Designer lives in Center panel → Theme Designer tab

---

## 6. Scripture Cross-Reference Display

### Location
Right panel → Cross-refs tab

### Behavior
- When a verse is detected or selected, auto-populate with related verses from the 340k+ cross-reference database
- Each item shows: verse reference, preview text, vote count (relevance ranking)
- Sorted by vote count (stronger connections first)
- One-click actions: "Present" (send to broadcast), "Queue" (add to queue), "Copy"
- During live sermon: updates automatically as new verses are detected

### Implementation
No new backend work — the `get_cross_references` Tauri command already exists. Frontend-only feature.

---

## 7. Verse History & Analytics

### Location
Center panel → Analytics tab

### Features
- **Session archive:** Browse all past sessions with metadata (date, speaker, series, verse count)
- **Verse frequency:** Which verses are preached most often across all sessions
- **Timeline view:** Verses detected per session, plotted over time
- **Search:** Find sessions by verse, speaker, series, date range
- **Planned vs. actual:** For sessions with a planner, compare what was planned vs. detected

### Data
Queries across `sermon_sessions`, `session_detections`, and `session_transcript` tables.

### Charts
Recharts (already used in comms360) for frequency charts, timeline plots.

---

## 8. Remote Control Enhancement

### Current State
OSC + HTTP server with 8 commands (next, prev, theme, opacity, on_air, show, hide, confidence). Status polling at 1s intervals.

### Enhancement
Add a built-in web page served from the existing Axum HTTP server at `http://<local-ip>:8080`.

### Web UI Features
- Current live verse + broadcast status (on air / off air)
- Queue list with next/prev/present controls
- Quick theme switcher
- Confidence threshold slider
- Session timer

### Implementation
Single static HTML page bundled into Tauri app resources. Vanilla HTML/CSS/JS (no React). Polls `/api/v1/status` every 1s, sends commands via `POST /api/v1/command`.

No app install needed — any device with a browser on the same WiFi can control Manna.

**Note:** Web UI redesign is backlogged for a future release.

---

## 9. Post-Sermon Distribution

### Channels
- **Email** — SMTP or service (Resend/SendGrid). Formatted sermon recap to a mailing list.
- **WhatsApp** — via WhatsApp Business API or webhook (Twilio). Summary to a group.
- **Webhook** — generic POST to any URL (Slack, Discord, church management system).

### Workflow
1. Configure channels in Settings (email list, WhatsApp number, webhook URLs)
2. Session ends → review screen shows auto-generated summary
3. Pastor/tech team edits before sending
4. "Distribute" → sends to all configured channels
5. Optional "auto-distribute" toggle to skip review

### Data
Distribution history tracked in `session_distributions` table.

### Implementation
New Rust crate `manna-distribution`:
- HTTP POST for webhooks
- SMTP for email
- Configurable templates per channel

Frontend: distribution config in Settings drawer, send controls on session review screen.

---

## 10. Worship/Song Lyric Integration

### Song Library
- Left panel → Songs tab
- Store songs locally: title, artist, lyrics (with verse/chorus/bridge sections), tags
- Search and browse

### Import Formats
- **ProPresenter** — .pro files (XML-based)
- **OpenLP** — .xml service files
- **EasyWorship** — .ewsx files
- **SongSelect (CCLI)** — .usr files
- **Generic** — plain text, ChordPro, OpenLyrics XML
- Import wizard: drag-and-drop → detect format → preview → confirm

### Database Schema

```sql
CREATE TABLE songs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  artist TEXT,
  tags TEXT,                   -- JSON array
  key TEXT,
  tempo INTEGER,
  ccli_number TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE song_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id INTEGER NOT NULL REFERENCES songs(id),
  type TEXT NOT NULL,          -- verse | chorus | bridge | intro | outro | pre-chorus
  section_order INTEGER NOT NULL,
  lyrics TEXT NOT NULL
);
CREATE INDEX idx_song_sections_song ON song_sections(song_id);
```

### Live Service Integration
- Songs can be queued alongside scripture in the verse queue
- When a song is live, broadcast overlay switches from verse to lyric display
- Lyrics advance manually (next slide) or via planner sequence

### Out of Scope (for now)
- Chord charts / musician view
- CCLI reporting integration
- Audio playback

---

## 11. Announcement/Lower-Third Overlay

### Concept
Reuse the existing NDI broadcast pipeline for general announcements beyond scripture.

### Broadcast Mode
New "Announcement" mode alongside existing "Verse" mode:
- Headline text + optional body text + optional icon/image
- Uses active theme's styling (background, fonts, colors, positioning)
- Each `BroadcastTheme` gains an `announcement` property block (headline font/size/color, body font/size/color) alongside the existing `verseText` and `reference` blocks — same theme, different text layout for announcements

### UI
- Quick-access button in toolbar: "New Announcement"
- Opens Vaul drawer with: headline input, body input (optional), duration (auto-dismiss or manual), preview
- "Go Live" pushes to NDI output, replacing current verse display
- Auto-dismiss returns to previous verse (or blank)

### Pre-Built Templates
- Freeform text
- "Welcome to [Church Name]"
- "Offering / Tithes"
- "Next Service: [time]"
- Custom templates saved by the church

### Data
Announcement templates stored in `manna.db`. Live announcements are ephemeral unless user toggles "log to session."

---

## Wave Structure

### Wave 1 — Foundation
1. Sermon Session Model (new DB, Rust crate, Zustand store)
2. UI Revamp (menu bar, toolbar, 3-panel workspace, design system migration)

### Wave 2 — Core Features
3. Sermon Planner
4. Sermon Notes & Export
5. Verse History & Analytics
6. Scripture Cross-Reference Display
7. Custom Overlay Themes (enhancements)

### Wave 3 — Integration Features
8. Remote Control Enhancement
9. Post-Sermon Distribution
10. Worship/Song Lyric Integration
11. Announcement/Lower-Third Overlay

### Backlog
- Congregation follow-along mode
- Multi-speaker support
- Pastor's dashboard
- Sermon series/campaign manager
- Prayer request integration
- Multilingual live toggle
- Cloud hosting (thin client + cloud hybrid)
- Remote control web UI redesign
