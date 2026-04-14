# Verse History & Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically record detections and transcripts during live sessions, display session history with detail views, and show aggregate analytics across all sessions.

**Architecture:** Wire session recording into the existing transcript event listeners, add aggregate query methods to the Rust DB layer, enhance the Sessions panel with a detail view, and build an Analytics dashboard component with CSS bar charts.

**Tech Stack:** React 19, TypeScript, Zustand, Tauri commands, Rust (rusqlite), CSS bar charts

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `src/components/panels/analytics-panel.tsx` | Aggregate analytics dashboard |
| `src/components/panels/session-detail.tsx` | Individual session detail view |
| `src-tauri/src/commands/analytics.rs` | Tauri commands for aggregate queries |

### Modified Files

| File | Changes |
|------|---------|
| `src/components/panels/transcript-panel.tsx` | Add session recording on detection/transcript events |
| `src/components/panels/sessions-panel.tsx` | Add session detail view navigation |
| `src/components/layout/workspace.tsx` | Replace Analytics placeholder with AnalyticsPanel |
| `src-tauri/crates/notes/src/db.rs` | Add aggregate query methods |
| `src-tauri/src/commands/mod.rs` | Add `pub mod analytics;` |
| `src-tauri/src/lib.rs` | Register analytics commands |

---

## Task 1: Wire Session Recording

**Files:**
- Modify: `src/components/panels/transcript-panel.tsx`

- [ ] **Step 1: Add session recording for detections**

In `transcript-panel.tsx`, find the `useTauriEvent<DetectionResult[]>("verse_detections", ...)` handler (around line 73). After the existing `useDetectionStore.getState().addDetections(detections)` call, add session recording:

```typescript
// Record detections to active session
const activeSession = useSessionStore.getState().activeSession
if (activeSession && activeSession.status === "live") {
  for (const d of detections) {
    invoke("add_session_detection", {
      request: {
        sessionId: activeSession.id,
        verseRef: d.verse_ref,
        verseText: d.verse_text || "",
        translation: useBibleStore.getState().translations
          .find(t => t.id === useBibleStore.getState().activeTranslationId)?.abbreviation ?? "KJV",
        confidence: d.confidence,
        source: d.source,
        transcriptSnippet: d.transcript_snippet || null,
      }
    }).catch(() => {})
  }
}
```

Add `useSessionStore` to the imports from `@/stores`.

- [ ] **Step 2: Add session recording for transcript segments**

Find the `useTauriEvent<TranscriptSegment>("transcript_final", ...)` handler or the equivalent event listener. After processing the transcript, add:

```typescript
// Record transcript to active session
const activeSession = useSessionStore.getState().activeSession
if (activeSession && activeSession.status === "live") {
  invoke("add_session_transcript", {
    request: {
      sessionId: activeSession.id,
      text: payload.text,
      isFinal: true,
      confidence: payload.confidence || null,
      timestampMs: Date.now(),
      speakerLabel: null,
    }
  }).catch(() => {})
}
```

- [ ] **Step 3: Verify and commit**

```bash
cd /Users/uxderrick-mac/Development/Manna && export PATH="$HOME/.bun/bin:$PATH"
bun run typecheck
git add src/components/panels/transcript-panel.tsx
git commit -m "feat: auto-record detections and transcript during live sessions"
```

---

## Task 2: Aggregate Query Methods (Rust)

**Files:**
- Modify: `src-tauri/crates/notes/src/db.rs`
- Create: `src-tauri/src/commands/analytics.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add aggregate query methods to SessionDb**

Add to `src-tauri/crates/notes/src/db.rs`:

```rust
// ── Analytics ─────────────────────────────────────────────

pub fn get_aggregate_stats(&self) -> Result<(i64, i64, f64, String)> {
    let total_sessions: i64 = self.conn
        .query_row("SELECT COUNT(*) FROM sermon_sessions WHERE status = 'completed'", [], |r| r.get(0))
        .unwrap_or(0);

    let total_detections: i64 = self.conn
        .query_row("SELECT COUNT(*) FROM session_detections", [], |r| r.get(0))
        .unwrap_or(0);

    // Total hours: sum of (ended_at - started_at) for completed sessions
    let total_hours: f64 = self.conn
        .query_row(
            "SELECT COALESCE(SUM((julianday(ended_at) - julianday(started_at)) * 24), 0.0) FROM sermon_sessions WHERE status = 'completed' AND started_at IS NOT NULL AND ended_at IS NOT NULL",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0.0);

    // Most detected book
    let top_book: String = self.conn
        .query_row(
            "SELECT verse_ref FROM session_detections GROUP BY substr(verse_ref, 1, instr(verse_ref, ' ') - 1) ORDER BY COUNT(*) DESC LIMIT 1",
            [],
            |r| {
                let full_ref: String = r.get(0)?;
                Ok(full_ref.split(' ').next().unwrap_or("Unknown").to_string())
            },
        )
        .unwrap_or_else(|_| "None".to_string());

    Ok((total_sessions, total_detections, total_hours, top_book))
}

pub fn get_verse_frequency(&self, limit: i64) -> Result<Vec<(String, i64)>> {
    let mut stmt = self.conn.prepare(
        "SELECT verse_ref, COUNT(*) as cnt FROM session_detections GROUP BY verse_ref ORDER BY cnt DESC LIMIT ?1"
    )?;
    let rows = stmt
        .query_map(params![limit], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn get_recent_sessions(&self, limit: i64) -> Result<Vec<SermonSession>> {
    let mut stmt = self.conn.prepare(
        "SELECT id, title, speaker, date, series_name, tags, started_at, ended_at,
                status, planned_scriptures, summary, created_at, updated_at
         FROM sermon_sessions ORDER BY created_at DESC LIMIT ?1",
    )?;
    let sessions = stmt
        .query_map(params![limit], |row| Ok(row_to_session(row)))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(sessions)
}

pub fn get_session_detection_count(&self, session_id: i64) -> Result<i64> {
    let count: i64 = self.conn
        .query_row(
            "SELECT COUNT(*) FROM session_detections WHERE session_id = ?1",
            params![session_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    Ok(count)
}
```

- [ ] **Step 2: Create analytics Tauri commands**

Create `src-tauri/src/commands/analytics.rs`:

```rust
use rhema_notes::SessionDb;
use rhema_notes::SermonSession;
use std::sync::Mutex;
use tauri::State;

type DbState = Mutex<SessionDb>;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AggregateStats {
    pub total_sessions: i64,
    pub total_detections: i64,
    pub total_hours: f64,
    pub top_book: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerseFrequency {
    pub verse_ref: String,
    pub count: i64,
}

#[tauri::command]
pub fn get_aggregate_stats(db: State<'_, DbState>) -> Result<AggregateStats, String> {
    let (total_sessions, total_detections, total_hours, top_book) = db
        .lock()
        .unwrap()
        .get_aggregate_stats()
        .map_err(|e| e.to_string())?;
    Ok(AggregateStats {
        total_sessions,
        total_detections,
        total_hours,
        top_book,
    })
}

#[tauri::command]
pub fn get_verse_frequency(db: State<'_, DbState>, limit: i64) -> Result<Vec<VerseFrequency>, String> {
    let rows = db
        .lock()
        .unwrap()
        .get_verse_frequency(limit)
        .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|(verse_ref, count)| VerseFrequency { verse_ref, count })
        .collect())
}

#[tauri::command]
pub fn get_recent_sessions(db: State<'_, DbState>, limit: i64) -> Result<Vec<SermonSession>, String> {
    db.lock()
        .unwrap()
        .get_recent_sessions(limit)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_session_detection_count(db: State<'_, DbState>, session_id: i64) -> Result<i64, String> {
    db.lock()
        .unwrap()
        .get_session_detection_count(session_id)
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 3: Register module and commands**

In `src-tauri/src/commands/mod.rs`, add: `pub mod analytics;`

In `src-tauri/src/lib.rs`, add to `invoke_handler`:
```rust
commands::analytics::get_aggregate_stats,
commands::analytics::get_verse_frequency,
commands::analytics::get_recent_sessions,
commands::analytics::get_session_detection_count,
```

- [ ] **Step 4: Verify and commit**

```bash
cd /Users/uxderrick-mac/Development/Manna/src-tauri && export PATH="$HOME/.cargo/bin:$PATH"
cargo check --no-default-features
cd .. && git add src-tauri/
git commit -m "feat: add aggregate analytics queries and Tauri commands"
```

---

## Task 3: Session Detail View

**Files:**
- Create: `src/components/panels/session-detail.tsx`
- Modify: `src/components/panels/sessions-panel.tsx`

- [ ] **Step 1: Create session detail component**

Create `src/components/panels/session-detail.tsx`:

```tsx
import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ArrowLeftIcon, BookOpenIcon, MicIcon, BarChart3Icon } from "lucide-react"
import type { SessionDetection, SessionTranscriptSegment } from "@/types/session"

interface SessionDetailProps {
  sessionId: number
  sessionTitle: string
  onBack: () => void
}

type DetailTab = "detections" | "transcript" | "stats"

export function SessionDetail({ sessionId, sessionTitle, onBack }: SessionDetailProps) {
  const [tab, setTab] = useState<DetailTab>("detections")
  const [detections, setDetections] = useState<SessionDetection[]>([])
  const [transcript, setTranscript] = useState<SessionTranscriptSegment[]>([])
  const [detectionCount, setDetectionCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      invoke<SessionDetection[]>("get_session_detections", { sessionId }),
      invoke<SessionTranscriptSegment[]>("get_session_transcript", { sessionId }),
      invoke<number>("get_session_detection_count", { sessionId }),
    ]).then(([dets, trans, count]) => {
      setDetections(dets)
      setTranscript(trans)
      setDetectionCount(count)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [sessionId])

  const presentedCount = detections.filter(d => d.wasPresented).length
  const uniqueBooks = new Set(detections.map(d => d.verseRef.split(" ")[0]))

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Button variant="ghost" size="icon-xs" onClick={onBack}>
          <ArrowLeftIcon className="size-3.5" />
        </Button>
        <span className="truncate text-sm font-semibold">{sessionTitle}</span>
      </div>

      {/* Tabs */}
      <div className="flex shrink-0 gap-1 border-b border-border px-3 py-1.5">
        {(["detections", "transcript", "stats"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors ${
              tab === t
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted/50"
            }`}
          >
            {t === "detections" && <BookOpenIcon className="size-3" />}
            {t === "transcript" && <MicIcon className="size-3" />}
            {t === "stats" && <BarChart3Icon className="size-3" />}
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <p className="text-xs text-muted-foreground">Loading...</p>
          </div>
        )}

        {!loading && tab === "detections" && (
          <div className="flex flex-col gap-0.5 p-2">
            {detections.length === 0 && (
              <p className="py-8 text-center text-xs text-muted-foreground">No detections recorded</p>
            )}
            {detections.map((d, i) => (
              <div key={i} className="rounded-lg p-2 hover:bg-muted/30">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-primary">{d.verseRef}</span>
                  <span className="text-[9px] tabular-nums text-muted-foreground">{Math.round(d.confidence * 100)}%</span>
                  <Badge variant="outline" className="text-[8px]">{d.source}</Badge>
                  {d.wasPresented && <Badge className="bg-primary/15 text-[8px] text-primary">Shown</Badge>}
                </div>
                {d.verseText && (
                  <p className="mt-0.5 line-clamp-1 font-serif text-[11px] text-muted-foreground">{d.verseText}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {!loading && tab === "transcript" && (
          <div className="p-3">
            {transcript.length === 0 && (
              <p className="py-8 text-center text-xs text-muted-foreground">No transcript recorded</p>
            )}
            <div className="flex flex-col gap-2">
              {transcript.map((seg, i) => (
                <p key={i} className="text-sm leading-relaxed text-foreground/80">{seg.text}</p>
              ))}
            </div>
          </div>
        )}

        {!loading && tab === "stats" && (
          <div className="flex flex-col gap-3 p-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-muted/30 p-3">
                <p className="text-lg font-bold text-foreground">{detectionCount}</p>
                <p className="text-[10px] text-muted-foreground">Detections</p>
              </div>
              <div className="rounded-lg bg-muted/30 p-3">
                <p className="text-lg font-bold text-foreground">{presentedCount}</p>
                <p className="text-[10px] text-muted-foreground">Shown on Screen</p>
              </div>
              <div className="rounded-lg bg-muted/30 p-3">
                <p className="text-lg font-bold text-foreground">{uniqueBooks.size}</p>
                <p className="text-[10px] text-muted-foreground">Books Referenced</p>
              </div>
              <div className="rounded-lg bg-muted/30 p-3">
                <p className="text-lg font-bold text-foreground">{transcript.length}</p>
                <p className="text-[10px] text-muted-foreground">Transcript Segments</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add detail view navigation to Sessions panel**

In `sessions-panel.tsx`, add state for viewing a session detail. When a session row is clicked, show `SessionDetail` instead of the list.

Add state: `const [viewingSessionId, setViewingSessionId] = useState<number | null>(null)`

If `viewingSessionId` is set, render `<SessionDetail sessionId={viewingSessionId} sessionTitle={...} onBack={() => setViewingSessionId(null)} />` instead of the session list.

On each session row's click handler, call `setViewingSessionId(session.id)`.

Import `SessionDetail` from `./session-detail`.

- [ ] **Step 3: Verify and commit**

```bash
bun run typecheck
git add src/components/panels/session-detail.tsx src/components/panels/sessions-panel.tsx
git commit -m "feat: session detail view with detections, transcript, and stats tabs"
```

---

## Task 4: Analytics Dashboard

**Files:**
- Create: `src/components/panels/analytics-panel.tsx`
- Modify: `src/components/layout/workspace.tsx`

- [ ] **Step 1: Create the analytics panel**

Create `src/components/panels/analytics-panel.tsx`:

```tsx
import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { PanelHeader } from "@/components/ui/panel-header"
import { Badge } from "@/components/ui/badge"
import { BarChart3Icon, BookOpenIcon, ClockIcon, HashIcon } from "lucide-react"
import type { SermonSession } from "@/types/session"

interface AggregateStats {
  totalSessions: number
  totalDetections: number
  totalHours: number
  topBook: string
}

interface VerseFrequency {
  verseRef: string
  count: number
}

export function AnalyticsPanel() {
  const [stats, setStats] = useState<AggregateStats | null>(null)
  const [verseFreq, setVerseFreq] = useState<VerseFrequency[]>([])
  const [recentSessions, setRecentSessions] = useState<SermonSession[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      invoke<AggregateStats>("get_aggregate_stats"),
      invoke<VerseFrequency[]>("get_verse_frequency", { limit: 10 }),
      invoke<SermonSession[]>("get_recent_sessions", { limit: 10 }),
    ]).then(([s, vf, rs]) => {
      setStats(s)
      setVerseFreq(vf)
      setRecentSessions(rs)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const maxCount = verseFreq.length > 0 ? verseFreq[0].count : 1

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-card">
        <p className="text-xs text-muted-foreground">Loading analytics...</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-card">
      <PanelHeader title="Analytics">
        <button
          onClick={() => {
            setLoading(true)
            Promise.all([
              invoke<AggregateStats>("get_aggregate_stats"),
              invoke<VerseFrequency[]>("get_verse_frequency", { limit: 10 }),
              invoke<SermonSession[]>("get_recent_sessions", { limit: 10 }),
            ]).then(([s, vf, rs]) => {
              setStats(s)
              setVerseFreq(vf)
              setRecentSessions(rs)
              setLoading(false)
            }).catch(() => setLoading(false))
          }}
          className="text-[10px] text-muted-foreground hover:text-foreground"
        >
          Refresh
        </button>
      </PanelHeader>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {/* Stat Cards */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-surface-elevated p-3 ring-1 ring-border">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <HashIcon className="size-3" />
              <span className="text-[10px] font-medium">Sessions</span>
            </div>
            <p className="mt-1 text-xl font-bold">{stats?.totalSessions ?? 0}</p>
          </div>
          <div className="rounded-xl bg-surface-elevated p-3 ring-1 ring-border">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <BookOpenIcon className="size-3" />
              <span className="text-[10px] font-medium">Verses Detected</span>
            </div>
            <p className="mt-1 text-xl font-bold">{stats?.totalDetections ?? 0}</p>
          </div>
          <div className="rounded-xl bg-surface-elevated p-3 ring-1 ring-border">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <ClockIcon className="size-3" />
              <span className="text-[10px] font-medium">Hours</span>
            </div>
            <p className="mt-1 text-xl font-bold">{(stats?.totalHours ?? 0).toFixed(1)}</p>
          </div>
          <div className="rounded-xl bg-surface-elevated p-3 ring-1 ring-border">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <BarChart3Icon className="size-3" />
              <span className="text-[10px] font-medium">Top Book</span>
            </div>
            <p className="mt-1 truncate text-sm font-bold">{stats?.topBook ?? "—"}</p>
          </div>
        </div>

        {/* Verse Frequency */}
        {verseFreq.length > 0 && (
          <div className="mt-4">
            <h3 className="text-xs font-bold text-foreground">Most Preached Verses</h3>
            <div className="mt-2 flex flex-col gap-1.5">
              {verseFreq.map((vf, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 truncate text-[11px] font-medium text-primary">{vf.verseRef}</span>
                  <div className="flex-1">
                    <div
                      className="h-4 rounded-full bg-primary/20"
                      style={{ width: `${(vf.count / maxCount) * 100}%` }}
                    >
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: "100%" }}
                      />
                    </div>
                  </div>
                  <span className="w-6 text-right text-[10px] tabular-nums text-muted-foreground">{vf.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent Sessions */}
        {recentSessions.length > 0 && (
          <div className="mt-4">
            <h3 className="text-xs font-bold text-foreground">Recent Sessions</h3>
            <div className="mt-2 flex flex-col gap-1">
              {recentSessions.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-lg p-2 hover:bg-muted/30">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-xs font-medium">{s.title}</span>
                    <span className="text-[10px] text-muted-foreground">{s.date}</span>
                  </div>
                  <Badge variant="outline" className="shrink-0 text-[8px] capitalize">{s.status}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!stats?.totalSessions && verseFreq.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <BarChart3Icon className="size-8 text-muted-foreground/30" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">No data yet</p>
              <p className="text-xs text-muted-foreground/60">Analytics will appear after your first sermon session.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire analytics panel into workspace**

In `workspace.tsx`, add import:
```typescript
import { AnalyticsPanel } from "@/components/panels/analytics-panel"
```

Replace the analytics placeholder:
```typescript
// Change:
{ id: "analytics", label: "Analytics", content: <Placeholder label="Analytics" /> }
// To:
{ id: "analytics", label: "Analytics", content: <AnalyticsPanel /> }
```

- [ ] **Step 3: Verify and commit**

```bash
bun run typecheck
git add src/components/panels/analytics-panel.tsx src/components/layout/workspace.tsx
git commit -m "feat: analytics dashboard with stat cards, verse frequency chart, recent sessions"
```

---

## Task 5: Smoke Test

- [ ] **Step 1: Restart the app**

```bash
pkill -f "target/debug/app"; pkill -f "tauri dev"; pkill -f "bun run tauri"; pkill -f "node.*vite"; lsof -ti:3000 | xargs kill -9
export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$PATH"
bun run tauri dev &
disown
```

- [ ] **Step 2: Test session recording**

1. Create a new session in the Sessions tab
2. Start transcription
3. Speak some Bible references
4. End the session
5. Click into the session in the Sessions tab → verify detections and transcript were saved

- [ ] **Step 3: Test analytics**

1. Switch to the Analytics tab in the center panel
2. Verify stat cards show data (sessions, detections, hours, top book)
3. Verify verse frequency chart shows bars
4. Verify recent sessions list shows the session you just completed

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Wire session recording (detections + transcript) |
| 2 | Aggregate analytics queries (Rust + Tauri) |
| 3 | Session detail view (detections, transcript, stats tabs) |
| 4 | Analytics dashboard panel |
| 5 | Smoke test |
