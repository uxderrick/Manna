# Verse History & Analytics — Design Spec

**Date:** 2026-04-14
**Wave:** 2, Feature 3
**Scope:** Wire session recording during live sessions, build session detail view, build analytics dashboard

---

## Part A: Session Recording

### What Gets Recorded

When a session has status `"live"`, the app automatically saves to `manna.db`:

1. **Every verse detection** → `session_detections` table
   - verse_ref, verse_text, translation, confidence, source, detected_at, transcript_snippet
2. **Every final transcript segment** → `session_transcript` table
   - text, is_final, confidence, timestamp_ms
3. **Presentation status** → `session_detections.was_presented`
   - Set to `true` when Go Live is clicked for that verse

### Where Recording Happens

- `transcript-panel.tsx` — already listens to `verse_detections` and `transcript_final` events
- On each event, check `useSessionStore.getState().activeSession`
- If active session exists and status is `"live"`, call the corresponding Tauri command:
  - `add_session_detection(request)` — for each detection
  - `add_session_transcript(request)` — for each final transcript segment
- When Go Live is clicked (in detection cards, search cards, queue), if active session exists, call `mark_detection_presented(detectionId)` — note: we may need to track detection IDs from the DB response

### No User Action Needed

Recording is automatic. Starts when session goes "live", stops when session ends.

---

## Part B: Sessions Tab (Individual Session Detail)

### Location

Left panel → Sessions tab (already exists, currently shows session list).

### Session List View

- List of past sessions, newest first
- Each row shows:
  - Title (bold)
  - Date (formatted, e.g., "Apr 12, 2026")
  - Speaker name (if set, muted text)
  - Duration (e.g., "1h 23m")
  - Verse count badge
  - Status badge (completed / live / planned)
- Click a session → opens detail view
- "New Session" button at top (already exists)

### Session Detail View

- Back arrow to return to list
- Header: title, date, speaker, duration, status
- Three sub-tabs or sections:

**Detections section:**
- All verses detected during the session
- Each card: verse reference, text, confidence %, source badge, timestamp
- Sorted by detection time (chronological)
- "Was presented" indicator for verses that went to screen

**Transcript section:**
- Full transcript text from the session
- Timestamped segments
- Scrollable

**Stats section:**
- Total detections count
- Verses presented count
- Session duration
- Most referenced book
- Detection sources breakdown (direct vs semantic)

---

## Part C: Analytics Tab (Aggregate Dashboard)

### Location

Center panel → Analytics tab (replacing the placeholder).

### Stat Cards (Top Row)

Four cards in a horizontal row:

| Card | Value | Label |
|------|-------|-------|
| Total sessions | count | "Sessions" |
| Total verses detected | count | "Verses Detected" |
| Total hours | sum of durations | "Hours of Sermons" |
| Most preached book | book name | "Top Book" |

### Verse Frequency Chart

- Horizontal bar chart showing top 10 most detected verses across all sessions
- Each bar shows: verse reference, count, colored bar (primary color, width proportional to max)
- Simple CSS implementation (colored divs), no chart library

### Recent Sessions Table

- Compact list of last 10 sessions
- Columns: date, title, verses detected, duration
- Click to navigate to session detail in Sessions tab

---

## Data Queries Needed

### New Tauri Commands

These query `manna.db` via the `rhema-notes` crate:

1. `get_session_stats(session_id)` → `{ detection_count, presented_count, duration_seconds, top_book, source_breakdown }`
2. `get_aggregate_stats()` → `{ total_sessions, total_detections, total_hours, top_book }`
3. `get_verse_frequency(limit)` → `Vec<{ verse_ref, count }>` — top N most detected verses across all sessions
4. `get_recent_sessions(limit)` → `Vec<SermonSession>` — most recent N sessions

### Existing Commands (Already Built)

- `list_sessions()` — all sessions
- `get_session(id)` — single session
- `get_session_detections(session_id)` — all detections for a session
- `get_session_transcript(session_id)` — all transcript segments for a session

---

## Implementation Order

1. Wire session recording in transcript-panel (detections + transcript segments)
2. Add new aggregate query commands (Rust + Tauri)
3. Enhance Sessions tab with detail view
4. Build Analytics tab dashboard
5. Smoke test
