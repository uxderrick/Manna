# Wave 1: Foundation — Sermon Session Model + UI Revamp

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the sermon session data layer and replace the current rigid grid UI with a desktop workspace layout matching the comms360/complianceOS design DNA.

**Architecture:** New `manna.db` SQLite database managed by the expanded `rhema-notes` crate. New Tauri commands expose session CRUD. Frontend gets a new `session-store` (Zustand) and a complete layout rewrite: menu bar + toolbar + 3 resizable panels + collapsible transcript bar. Existing panels (transcript, detections, search, queue, preview, broadcast) are preserved as tab contents within the new layout.

**Tech Stack:** Rust (rusqlite, serde, tauri), React 19, TypeScript, Zustand, Tailwind v4, Radix UI, CVA, Phosphor Icons, Vaul, Sonner, react-resizable-panels

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `src-tauri/crates/notes/src/db.rs` | manna.db connection, migrations, session CRUD queries |
| `src-tauri/crates/notes/src/models.rs` | SermonSession, SessionDetection, SessionTranscript, SessionNote, SessionDistribution structs |
| `src-tauri/crates/notes/src/error.rs` | Error types for the notes crate |
| `src-tauri/src/commands/session.rs` | Tauri commands for session lifecycle |
| `src/types/session.ts` | TypeScript types for sermon sessions |
| `src/stores/session-store.ts` | Zustand store for active session state |
| `src/components/layout/workspace.tsx` | New root layout: menu bar + toolbar + panels |
| `src/components/layout/menu-bar.tsx` | Custom in-app menu bar |
| `src/components/layout/toolbar.tsx` | Session controls, audio meter, quick actions |
| `src/components/layout/panel-tabs.tsx` | Tab container component for panels |
| `src/hooks/use-session.ts` | Hook wrapping session Tauri commands |

### Modified Files

| File | Changes |
|------|---------|
| `src-tauri/crates/notes/Cargo.toml` | Add rusqlite, chrono dependencies |
| `src-tauri/crates/notes/src/lib.rs` | Export modules (db, models, error) |
| `src-tauri/src/commands/mod.rs` | Add `pub mod session;` |
| `src-tauri/src/lib.rs` | Register session commands, manage SessionDb state |
| `src-tauri/src/state.rs` | Add SessionDb to managed state |
| `src/App.tsx` | Replace Dashboard with Workspace |
| `src/main.tsx` | Add Sonner position change to top-right |
| `src/stores/index.ts` | Export useSessionStore |
| `src/types/index.ts` | Export session types |
| `src/index.css` | Add design DNA tokens (OKLCH primary, easing curves, durations) |
| `src/components/controls/transport-bar.tsx` | Refactored into toolbar.tsx |
| `package.json` | Add @phosphor-icons/react, react-resizable-panels |

---

## Task 1: Install New Frontend Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install dependencies**

```bash
cd /Users/uxderrick-mac/Development/Manna
export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$PATH"
bun add @phosphor-icons/react react-resizable-panels vaul
```

Note: Sonner is already installed. Vaul may already be present via shadcn — check first with `grep vaul package.json`. If already present, skip installing vaul.

- [ ] **Step 2: Verify installation**

```bash
bun run typecheck
```

Expected: No errors (new deps are not imported yet).

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add phosphor-icons, react-resizable-panels, vaul"
```

---

## Task 2: Sermon Session Rust Types

**Files:**
- Create: `src-tauri/crates/notes/src/models.rs`
- Create: `src-tauri/crates/notes/src/error.rs`
- Modify: `src-tauri/crates/notes/src/lib.rs`
- Modify: `src-tauri/crates/notes/Cargo.toml`

- [ ] **Step 1: Add dependencies to notes crate**

In `src-tauri/crates/notes/Cargo.toml`, replace contents with:

```toml
[package]
name = "rhema-notes"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { workspace = true, features = ["derive"] }
serde_json.workspace = true
log.workspace = true
thiserror.workspace = true
rusqlite = { version = "0.35", features = ["bundled"] }
chrono = { version = "0.4", features = ["serde"] }
```

- [ ] **Step 2: Create error types**

Create `src-tauri/crates/notes/src/error.rs`:

```rust
use thiserror::Error;

#[derive(Error, Debug)]
pub enum SessionError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("Session not found: {0}")]
    NotFound(i64),

    #[error("Invalid session state transition: {from} -> {to}")]
    InvalidTransition { from: String, to: String },

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, SessionError>;
```

- [ ] **Step 3: Create model structs**

Create `src-tauri/crates/notes/src/models.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Planned,
    Live,
    Completed,
}

impl SessionStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Planned => "planned",
            Self::Live => "live",
            Self::Completed => "completed",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "planned" => Some(Self::Planned),
            "live" => Some(Self::Live),
            "completed" => Some(Self::Completed),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SermonSession {
    pub id: i64,
    pub title: String,
    pub speaker: Option<String>,
    pub date: String,
    pub series_name: Option<String>,
    pub tags: Vec<String>,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub status: SessionStatus,
    pub planned_scriptures: Vec<PlannedScripture>,
    pub summary: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedScripture {
    pub verse_ref: String,
    pub translation: String,
    pub order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionRequest {
    pub title: String,
    pub speaker: Option<String>,
    pub date: String,
    pub series_name: Option<String>,
    pub tags: Option<Vec<String>>,
    pub planned_scriptures: Option<Vec<PlannedScripture>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetection {
    pub id: i64,
    pub session_id: i64,
    pub verse_ref: String,
    pub verse_text: String,
    pub translation: String,
    pub confidence: f64,
    pub source: String,
    pub detected_at: String,
    pub was_presented: bool,
    pub transcript_snippet: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTranscriptSegment {
    pub id: i64,
    pub session_id: i64,
    pub text: String,
    pub is_final: bool,
    pub confidence: Option<f64>,
    pub timestamp_ms: i64,
    pub speaker_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionNote {
    pub id: i64,
    pub session_id: i64,
    pub note_type: String,
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddNoteRequest {
    pub session_id: i64,
    pub note_type: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddDetectionRequest {
    pub session_id: i64,
    pub verse_ref: String,
    pub verse_text: String,
    pub translation: String,
    pub confidence: f64,
    pub source: String,
    pub transcript_snippet: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddTranscriptRequest {
    pub session_id: i64,
    pub text: String,
    pub is_final: bool,
    pub confidence: Option<f64>,
    pub timestamp_ms: i64,
    pub speaker_label: Option<String>,
}
```

- [ ] **Step 4: Update lib.rs exports**

Replace `src-tauri/crates/notes/src/lib.rs` with:

```rust
pub mod db;
pub mod error;
pub mod models;

pub use db::SessionDb;
pub use error::{Result, SessionError};
pub use models::*;
```

Note: `db` module doesn't exist yet — this will not compile until Task 3. That's expected.

- [ ] **Step 5: Verify models compile in isolation**

```bash
cd /Users/uxderrick-mac/Development/Manna/src-tauri
cargo check -p rhema-notes 2>&1 | head -20
```

Expected: Error about missing `db` module. Models and error types should be fine.

- [ ] **Step 6: Commit**

```bash
cd /Users/uxderrick-mac/Development/Manna
git add src-tauri/crates/notes/
git commit -m "feat(notes): add sermon session models and error types"
```

---

## Task 3: Session Database Layer

**Files:**
- Create: `src-tauri/crates/notes/src/db.rs`

- [ ] **Step 1: Create the database module**

Create `src-tauri/crates/notes/src/db.rs`:

```rust
use rusqlite::{params, Connection};
use std::path::Path;

use crate::error::{Result, SessionError};
use crate::models::*;

pub struct SessionDb {
    conn: Connection,
}

impl SessionDb {
    /// Open or create the manna.db database at the given path.
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        let db = Self { conn };
        db.migrate()?;
        Ok(db)
    }

    /// Run migrations to create tables if they don't exist.
    fn migrate(&self) -> Result<()> {
        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS sermon_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                speaker TEXT,
                date TEXT NOT NULL,
                series_name TEXT,
                tags TEXT DEFAULT '[]',
                started_at TEXT,
                ended_at TEXT,
                status TEXT NOT NULL DEFAULT 'planned',
                planned_scriptures TEXT DEFAULT '[]',
                summary TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS session_detections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL REFERENCES sermon_sessions(id) ON DELETE CASCADE,
                verse_ref TEXT NOT NULL,
                verse_text TEXT NOT NULL,
                translation TEXT NOT NULL,
                confidence REAL NOT NULL,
                source TEXT NOT NULL,
                detected_at TEXT NOT NULL DEFAULT (datetime('now')),
                was_presented INTEGER DEFAULT 0,
                transcript_snippet TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_session_detections_session
                ON session_detections(session_id);

            CREATE TABLE IF NOT EXISTS session_transcript (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL REFERENCES sermon_sessions(id) ON DELETE CASCADE,
                text TEXT NOT NULL,
                is_final INTEGER DEFAULT 1,
                confidence REAL,
                timestamp_ms INTEGER NOT NULL,
                speaker_label TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_session_transcript_session
                ON session_transcript(session_id);

            CREATE TABLE IF NOT EXISTS session_notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL REFERENCES sermon_sessions(id) ON DELETE CASCADE,
                note_type TEXT NOT NULL DEFAULT 'manual',
                content TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_session_notes_session
                ON session_notes(session_id);

            CREATE TABLE IF NOT EXISTS session_distributions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL REFERENCES sermon_sessions(id) ON DELETE CASCADE,
                channel TEXT NOT NULL,
                recipient TEXT NOT NULL,
                sent_at TEXT NOT NULL DEFAULT (datetime('now')),
                status TEXT NOT NULL DEFAULT 'sent'
            );
            CREATE INDEX IF NOT EXISTS idx_session_distributions_session
                ON session_distributions(session_id);
            ",
        )?;
        Ok(())
    }

    // ── Session CRUD ──────────────────────────────────────────────

    pub fn create_session(&self, req: &CreateSessionRequest) -> Result<SermonSession> {
        let tags_json = serde_json::to_string(&req.tags.as_deref().unwrap_or(&[]))?;
        let scriptures_json =
            serde_json::to_string(&req.planned_scriptures.as_deref().unwrap_or(&[]))?;

        self.conn.execute(
            "INSERT INTO sermon_sessions (title, speaker, date, series_name, tags, planned_scriptures)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                req.title,
                req.speaker,
                req.date,
                req.series_name,
                tags_json,
                scriptures_json,
            ],
        )?;

        let id = self.conn.last_insert_rowid();
        self.get_session(id)
    }

    pub fn get_session(&self, id: i64) -> Result<SermonSession> {
        self.conn
            .query_row(
                "SELECT id, title, speaker, date, series_name, tags, started_at, ended_at,
                        status, planned_scriptures, summary, created_at, updated_at
                 FROM sermon_sessions WHERE id = ?1",
                params![id],
                |row| Ok(row_to_session(row)),
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => SessionError::NotFound(id),
                other => SessionError::Database(other),
            })?
    }

    pub fn list_sessions(&self) -> Result<Vec<SermonSession>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, speaker, date, series_name, tags, started_at, ended_at,
                    status, planned_scriptures, summary, created_at, updated_at
             FROM sermon_sessions ORDER BY created_at DESC",
        )?;

        let sessions = stmt
            .query_map([], |row| Ok(row_to_session(row)))?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(sessions)
    }

    pub fn start_session(&self, id: i64) -> Result<SermonSession> {
        let current = self.get_session(id)?;
        if current.status != SessionStatus::Planned {
            return Err(SessionError::InvalidTransition {
                from: current.status.as_str().to_string(),
                to: "live".to_string(),
            });
        }

        self.conn.execute(
            "UPDATE sermon_sessions SET status = 'live', started_at = datetime('now'), updated_at = datetime('now')
             WHERE id = ?1",
            params![id],
        )?;
        self.get_session(id)
    }

    pub fn end_session(&self, id: i64) -> Result<SermonSession> {
        let current = self.get_session(id)?;
        if current.status != SessionStatus::Live {
            return Err(SessionError::InvalidTransition {
                from: current.status.as_str().to_string(),
                to: "completed".to_string(),
            });
        }

        self.conn.execute(
            "UPDATE sermon_sessions SET status = 'completed', ended_at = datetime('now'), updated_at = datetime('now')
             WHERE id = ?1",
            params![id],
        )?;
        self.get_session(id)
    }

    pub fn update_session_summary(&self, id: i64, summary: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE sermon_sessions SET summary = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![summary, id],
        )?;
        Ok(())
    }

    pub fn delete_session(&self, id: i64) -> Result<()> {
        let rows = self.conn.execute("DELETE FROM sermon_sessions WHERE id = ?1", params![id])?;
        if rows == 0 {
            return Err(SessionError::NotFound(id));
        }
        Ok(())
    }

    // ── Detections ────────────────────────────────────────────────

    pub fn add_detection(&self, req: &AddDetectionRequest) -> Result<SessionDetection> {
        self.conn.execute(
            "INSERT INTO session_detections (session_id, verse_ref, verse_text, translation, confidence, source, transcript_snippet)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                req.session_id,
                req.verse_ref,
                req.verse_text,
                req.translation,
                req.confidence,
                req.source,
                req.transcript_snippet,
            ],
        )?;

        let id = self.conn.last_insert_rowid();
        self.conn
            .query_row(
                "SELECT id, session_id, verse_ref, verse_text, translation, confidence, source, detected_at, was_presented, transcript_snippet
                 FROM session_detections WHERE id = ?1",
                params![id],
                |row| {
                    Ok(SessionDetection {
                        id: row.get(0)?,
                        session_id: row.get(1)?,
                        verse_ref: row.get(2)?,
                        verse_text: row.get(3)?,
                        translation: row.get(4)?,
                        confidence: row.get(5)?,
                        source: row.get(6)?,
                        detected_at: row.get(7)?,
                        was_presented: row.get::<_, i32>(8)? != 0,
                        transcript_snippet: row.get(9)?,
                    })
                },
            )
            .map_err(SessionError::Database)
    }

    pub fn mark_detection_presented(&self, detection_id: i64) -> Result<()> {
        self.conn.execute(
            "UPDATE session_detections SET was_presented = 1 WHERE id = ?1",
            params![detection_id],
        )?;
        Ok(())
    }

    pub fn get_session_detections(&self, session_id: i64) -> Result<Vec<SessionDetection>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, session_id, verse_ref, verse_text, translation, confidence, source, detected_at, was_presented, transcript_snippet
             FROM session_detections WHERE session_id = ?1 ORDER BY detected_at ASC",
        )?;

        let detections = stmt
            .query_map(params![session_id], |row| {
                Ok(SessionDetection {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    verse_ref: row.get(2)?,
                    verse_text: row.get(3)?,
                    translation: row.get(4)?,
                    confidence: row.get(5)?,
                    source: row.get(6)?,
                    detected_at: row.get(7)?,
                    was_presented: row.get::<_, i32>(8)? != 0,
                    transcript_snippet: row.get(9)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(detections)
    }

    // ── Transcript ────────────────────────────────────────────────

    pub fn add_transcript(&self, req: &AddTranscriptRequest) -> Result<()> {
        self.conn.execute(
            "INSERT INTO session_transcript (session_id, text, is_final, confidence, timestamp_ms, speaker_label)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                req.session_id,
                req.text,
                req.is_final as i32,
                req.confidence,
                req.timestamp_ms,
                req.speaker_label,
            ],
        )?;
        Ok(())
    }

    pub fn get_session_transcript(&self, session_id: i64) -> Result<Vec<SessionTranscriptSegment>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, session_id, text, is_final, confidence, timestamp_ms, speaker_label
             FROM session_transcript WHERE session_id = ?1 ORDER BY timestamp_ms ASC",
        )?;

        let segments = stmt
            .query_map(params![session_id], |row| {
                Ok(SessionTranscriptSegment {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    text: row.get(2)?,
                    is_final: row.get::<_, i32>(3)? != 0,
                    confidence: row.get(4)?,
                    timestamp_ms: row.get(5)?,
                    speaker_label: row.get(6)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(segments)
    }

    // ── Notes ─────────────────────────────────────────────────────

    pub fn add_note(&self, req: &AddNoteRequest) -> Result<SessionNote> {
        self.conn.execute(
            "INSERT INTO session_notes (session_id, note_type, content) VALUES (?1, ?2, ?3)",
            params![req.session_id, req.note_type, req.content],
        )?;

        let id = self.conn.last_insert_rowid();
        self.conn
            .query_row(
                "SELECT id, session_id, note_type, content, created_at FROM session_notes WHERE id = ?1",
                params![id],
                |row| {
                    Ok(SessionNote {
                        id: row.get(0)?,
                        session_id: row.get(1)?,
                        note_type: row.get(2)?,
                        content: row.get(3)?,
                        created_at: row.get(4)?,
                    })
                },
            )
            .map_err(SessionError::Database)
    }

    pub fn get_session_notes(&self, session_id: i64) -> Result<Vec<SessionNote>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, session_id, note_type, content, created_at
             FROM session_notes WHERE session_id = ?1 ORDER BY created_at ASC",
        )?;

        let notes = stmt
            .query_map(params![session_id], |row| {
                Ok(SessionNote {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    note_type: row.get(2)?,
                    content: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(notes)
    }
}

// ── Helper ────────────────────────────────────────────────────────

fn row_to_session(row: &rusqlite::Row) -> SermonSession {
    let tags_str: String = row.get::<_, String>(5).unwrap_or_else(|_| "[]".to_string());
    let scriptures_str: String = row.get::<_, String>(9).unwrap_or_else(|_| "[]".to_string());

    SermonSession {
        id: row.get(0).unwrap_or(0),
        title: row.get(1).unwrap_or_default(),
        speaker: row.get(2).ok(),
        date: row.get(3).unwrap_or_default(),
        series_name: row.get(4).ok(),
        tags: serde_json::from_str(&tags_str).unwrap_or_default(),
        started_at: row.get(6).ok(),
        ended_at: row.get(7).ok(),
        status: SessionStatus::from_str(&row.get::<_, String>(8).unwrap_or_default())
            .unwrap_or(SessionStatus::Planned),
        planned_scriptures: serde_json::from_str(&scriptures_str).unwrap_or_default(),
        summary: row.get(10).ok(),
        created_at: row.get(11).unwrap_or_default(),
        updated_at: row.get(12).unwrap_or_default(),
    }
}
```

- [ ] **Step 2: Verify the notes crate compiles**

```bash
cd /Users/uxderrick-mac/Development/Manna/src-tauri
cargo check -p rhema-notes
```

Expected: Compiles with no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/uxderrick-mac/Development/Manna
git add src-tauri/crates/notes/
git commit -m "feat(notes): add session database layer with CRUD operations"
```

---

## Task 4: Tauri Session Commands

**Files:**
- Create: `src-tauri/src/commands/session.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create session commands**

Create `src-tauri/src/commands/session.rs`:

```rust
use rhema_notes::{
    AddDetectionRequest, AddNoteRequest, AddTranscriptRequest, CreateSessionRequest,
    SermonSession, SessionDb, SessionDetection, SessionNote, SessionTranscriptSegment,
};
use std::sync::Mutex;
use tauri::State;

type DbState = Mutex<SessionDb>;

#[tauri::command]
pub fn create_session(
    db: State<'_, DbState>,
    request: CreateSessionRequest,
) -> Result<SermonSession, String> {
    db.lock()
        .unwrap()
        .create_session(&request)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_session(db: State<'_, DbState>, id: i64) -> Result<SermonSession, String> {
    db.lock()
        .unwrap()
        .get_session(id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_sessions(db: State<'_, DbState>) -> Result<Vec<SermonSession>, String> {
    db.lock()
        .unwrap()
        .list_sessions()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn start_session(db: State<'_, DbState>, id: i64) -> Result<SermonSession, String> {
    db.lock()
        .unwrap()
        .start_session(id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn end_session(db: State<'_, DbState>, id: i64) -> Result<SermonSession, String> {
    db.lock()
        .unwrap()
        .end_session(id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_session(db: State<'_, DbState>, id: i64) -> Result<(), String> {
    db.lock()
        .unwrap()
        .delete_session(id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_session_summary(
    db: State<'_, DbState>,
    id: i64,
    summary: String,
) -> Result<(), String> {
    db.lock()
        .unwrap()
        .update_session_summary(id, &summary)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_session_detection(
    db: State<'_, DbState>,
    request: AddDetectionRequest,
) -> Result<SessionDetection, String> {
    db.lock()
        .unwrap()
        .add_detection(&request)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_session_detections(
    db: State<'_, DbState>,
    session_id: i64,
) -> Result<Vec<SessionDetection>, String> {
    db.lock()
        .unwrap()
        .get_session_detections(session_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_session_transcript(
    db: State<'_, DbState>,
    request: AddTranscriptRequest,
) -> Result<(), String> {
    db.lock()
        .unwrap()
        .add_transcript(&request)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_session_transcript(
    db: State<'_, DbState>,
    session_id: i64,
) -> Result<Vec<SessionTranscriptSegment>, String> {
    db.lock()
        .unwrap()
        .get_session_transcript(session_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_session_note(
    db: State<'_, DbState>,
    request: AddNoteRequest,
) -> Result<SessionNote, String> {
    db.lock()
        .unwrap()
        .add_note(&request)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_session_notes(
    db: State<'_, DbState>,
    session_id: i64,
) -> Result<Vec<SessionNote>, String> {
    db.lock()
        .unwrap()
        .get_session_notes(session_id)
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Register session module**

In `src-tauri/src/commands/mod.rs`, add after the existing modules:

```rust
pub mod session;
```

- [ ] **Step 3: Wire up session commands and state in lib.rs**

In `src-tauri/src/lib.rs`:

Add import at the top (near the existing use statements):
```rust
use rhema_notes::SessionDb;
```

In the `run()` function, after the existing `.manage()` calls (around line 26), add:
```rust
.manage(Mutex::new({
    let app_data = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("com.manna.app");
    std::fs::create_dir_all(&app_data).ok();
    SessionDb::open(&app_data.join("manna.db"))
        .expect("Failed to open manna.db")
}))
```

In the `invoke_handler` macro (around lines 28-63), add the session commands:
```rust
commands::session::create_session,
commands::session::get_session,
commands::session::list_sessions,
commands::session::start_session,
commands::session::end_session,
commands::session::delete_session,
commands::session::update_session_summary,
commands::session::add_session_detection,
commands::session::get_session_detections,
commands::session::add_session_transcript,
commands::session::get_session_transcript,
commands::session::add_session_note,
commands::session::get_session_notes,
```

Also add `dirs` to `src-tauri/Cargo.toml` dependencies:
```toml
dirs = "6"
```

- [ ] **Step 4: Verify the full Rust project compiles**

```bash
cd /Users/uxderrick-mac/Development/Manna/src-tauri
cargo check
```

Expected: Compiles with no errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/uxderrick-mac/Development/Manna
git add src-tauri/src/commands/session.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat: add Tauri session commands and wire up manna.db"
```

---

## Task 5: Frontend Session Types and Store

**Files:**
- Create: `src/types/session.ts`
- Create: `src/stores/session-store.ts`
- Create: `src/hooks/use-session.ts`
- Modify: `src/types/index.ts`
- Modify: `src/stores/index.ts`

- [ ] **Step 1: Create session types**

Create `src/types/session.ts`:

```typescript
export type SessionStatus = "planned" | "live" | "completed"

export interface PlannedScripture {
  verseRef: string
  translation: string
  order: number
}

export interface SermonSession {
  id: number
  title: string
  speaker: string | null
  date: string
  seriesName: string | null
  tags: string[]
  startedAt: string | null
  endedAt: string | null
  status: SessionStatus
  plannedScriptures: PlannedScripture[]
  summary: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateSessionRequest {
  title: string
  speaker?: string
  date: string
  seriesName?: string
  tags?: string[]
  plannedScriptures?: PlannedScripture[]
}

export interface SessionDetection {
  id: number
  sessionId: number
  verseRef: string
  verseText: string
  translation: string
  confidence: number
  source: string
  detectedAt: string
  wasPresented: boolean
  transcriptSnippet: string | null
}

export interface SessionTranscriptSegment {
  id: number
  sessionId: number
  text: string
  isFinal: boolean
  confidence: number | null
  timestampMs: number
  speakerLabel: string | null
}

export interface SessionNote {
  id: number
  sessionId: number
  noteType: string
  content: string
  createdAt: string
}
```

- [ ] **Step 2: Create session hook**

Create `src/hooks/use-session.ts`:

```typescript
import { invoke } from "@tauri-apps/api/core"
import type {
  SermonSession,
  CreateSessionRequest,
  SessionDetection,
  SessionTranscriptSegment,
  SessionNote,
} from "@/types/session"

export function useSession() {
  return {
    createSession: (request: CreateSessionRequest) =>
      invoke<SermonSession>("create_session", { request }),

    getSession: (id: number) =>
      invoke<SermonSession>("get_session", { id }),

    listSessions: () =>
      invoke<SermonSession[]>("list_sessions"),

    startSession: (id: number) =>
      invoke<SermonSession>("start_session", { id }),

    endSession: (id: number) =>
      invoke<SermonSession>("end_session", { id }),

    deleteSession: (id: number) =>
      invoke<void>("delete_session", { id }),

    updateSummary: (id: number, summary: string) =>
      invoke<void>("update_session_summary", { id, summary }),

    addDetection: (request: {
      sessionId: number
      verseRef: string
      verseText: string
      translation: string
      confidence: number
      source: string
      transcriptSnippet?: string
    }) => invoke<SessionDetection>("add_session_detection", { request }),

    getDetections: (sessionId: number) =>
      invoke<SessionDetection[]>("get_session_detections", { sessionId }),

    addTranscript: (request: {
      sessionId: number
      text: string
      isFinal: boolean
      confidence?: number
      timestampMs: number
      speakerLabel?: string
    }) => invoke<void>("add_session_transcript", { request }),

    getTranscript: (sessionId: number) =>
      invoke<SessionTranscriptSegment[]>("get_session_transcript", { sessionId }),

    addNote: (request: { sessionId: number; noteType: string; content: string }) =>
      invoke<SessionNote>("add_session_note", { request }),

    getNotes: (sessionId: number) =>
      invoke<SessionNote[]>("get_session_notes", { sessionId }),
  }
}
```

- [ ] **Step 3: Create session store**

Create `src/stores/session-store.ts`:

```typescript
import { create } from "zustand"
import type { SermonSession } from "@/types/session"

interface SessionState {
  activeSession: SermonSession | null
  sessions: SermonSession[]
  isLoading: boolean
}

interface SessionActions {
  setActiveSession: (session: SermonSession | null) => void
  setSessions: (sessions: SermonSession[]) => void
  updateActiveSession: (updates: Partial<SermonSession>) => void
  setLoading: (loading: boolean) => void
}

export const useSessionStore = create<SessionState & SessionActions>((set) => ({
  activeSession: null,
  sessions: [],
  isLoading: false,

  setActiveSession: (session) => set({ activeSession: session }),
  setSessions: (sessions) => set({ sessions }),
  updateActiveSession: (updates) =>
    set((state) => ({
      activeSession: state.activeSession
        ? { ...state.activeSession, ...updates }
        : null,
    })),
  setLoading: (isLoading) => set({ isLoading }),
}))
```

- [ ] **Step 4: Update barrel exports**

In `src/types/index.ts`, add at the end:
```typescript
export type {
  SessionStatus,
  PlannedScripture,
  SermonSession,
  CreateSessionRequest,
  SessionDetection,
  SessionTranscriptSegment,
  SessionNote,
} from "./session"
```

In `src/stores/index.ts`, add at the end:
```typescript
export { useSessionStore } from "./session-store"
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /Users/uxderrick-mac/Development/Manna
export PATH="$HOME/.bun/bin:$PATH"
bun run typecheck
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/types/session.ts src/hooks/use-session.ts src/stores/session-store.ts src/types/index.ts src/stores/index.ts
git commit -m "feat: add session types, store, and hook for frontend"
```

---

## Task 6: Design System Tokens

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: Add design DNA tokens to index.css**

Add after the existing `@theme` block (around line 63 in `src/index.css`), before the `:root` block:

```css
/* ── Design DNA: Easing & Motion ────────────────────────── */
@theme {
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-smooth: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-snap: cubic-bezier(0.4, 0, 0.2, 1);
  --duration-fast: 150ms;
  --duration-normal: 200ms;
  --duration-slow: 300ms;
  --duration-slower: 500ms;
}
```

Also update the `:root` block to add the menu bar and toolbar sizing tokens:

```css
  --menu-bar-height: 28px;
  --toolbar-height: 40px;
```

- [ ] **Step 2: Add reduced motion support**

Add at the end of `src/index.css`:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 3: Verify styles compile**

```bash
cd /Users/uxderrick-mac/Development/Manna
export PATH="$HOME/.bun/bin:$PATH"
bun run dev &
sleep 3
kill %1
```

Expected: Vite starts without CSS errors.

- [ ] **Step 4: Commit**

```bash
git add src/index.css
git commit -m "feat: add design DNA tokens — easing curves, durations, motion preferences"
```

---

## Task 7: Menu Bar Component

**Files:**
- Create: `src/components/layout/menu-bar.tsx`

- [ ] **Step 1: Create the menu bar**

Create `src/components/layout/menu-bar.tsx`:

```tsx
import { useState, useRef, useEffect } from "react"
import { useTheme } from "@/components/theme-provider"
import { useSessionStore } from "@/stores"

interface MenuItem {
  label: string
  shortcut?: string
  action?: () => void
  separator?: boolean
  disabled?: boolean
}

interface Menu {
  label: string
  items: MenuItem[]
}

export function MenuBar() {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const { theme, setTheme } = useTheme()
  const activeSession = useSessionStore((s) => s.activeSession)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const menus: Menu[] = [
    {
      label: "Manna",
      items: [
        { label: "About Manna", action: () => {} },
        { separator: true, label: "" },
        { label: "Preferences…", shortcut: "⌘,", action: () => {} },
        { separator: true, label: "" },
        { label: "Quit Manna", shortcut: "⌘Q", action: () => {} },
      ],
    },
    {
      label: "Session",
      items: [
        { label: "New Session…", shortcut: "⌘N", action: () => {} },
        {
          label: "End Session",
          shortcut: "⌘⇧E",
          action: () => {},
          disabled: !activeSession || activeSession.status !== "live",
        },
        { separator: true, label: "" },
        { label: "Import Plan…", action: () => {} },
        { label: "Export Notes…", shortcut: "⌘⇧X", action: () => {}, disabled: !activeSession },
        { label: "Distribute Summary…", action: () => {}, disabled: !activeSession },
      ],
    },
    {
      label: "Broadcast",
      items: [
        { label: "Go Live", shortcut: "⌘L", action: () => {} },
        { label: "Go Off Air", shortcut: "⌘⇧L", action: () => {} },
        { separator: true, label: "" },
        { label: "New Announcement…", shortcut: "⌘⇧N", action: () => {} },
        { separator: true, label: "" },
        { label: "Theme Designer…", shortcut: "⌘T", action: () => {} },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Toggle Transcript", shortcut: "⌘J", action: () => {} },
        { label: "Reset Layout", action: () => {} },
        { separator: true, label: "" },
        {
          label: theme === "dark" ? "Light Mode" : "Dark Mode",
          action: () => setTheme(theme === "dark" ? "light" : "dark"),
        },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "Tutorial", action: () => {} },
        { label: "Keyboard Shortcuts", shortcut: "⌘/", action: () => {} },
        { separator: true, label: "" },
        { label: "Documentation", action: () => {} },
        { label: "Report Issue", action: () => {} },
      ],
    },
  ]

  return (
    <div
      ref={menuRef}
      data-slot="menu-bar"
      className="flex h-[var(--menu-bar-height)] select-none items-center border-b border-border bg-card/80 px-2 text-xs backdrop-blur-sm"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {menus.map((menu) => (
        <div key={menu.label} className="relative">
          <button
            className={`rounded-sm px-2 py-0.5 transition-colors duration-[var(--duration-fast)] ${
              openMenu === menu.label
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            }`}
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            onClick={() => setOpenMenu(openMenu === menu.label ? null : menu.label)}
            onMouseEnter={() => openMenu && setOpenMenu(menu.label)}
          >
            {menu.label}
          </button>

          {openMenu === menu.label && (
            <div className="absolute left-0 top-full z-50 mt-px min-w-[200px] rounded-md border border-border bg-popover p-1 shadow-md">
              {menu.items.map((item, i) =>
                item.separator ? (
                  <div key={i} className="my-1 h-px bg-border" />
                ) : (
                  <button
                    key={item.label}
                    className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-xs text-popover-foreground transition-colors duration-[var(--duration-fast)] hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                    disabled={item.disabled}
                    onClick={() => {
                      item.action?.()
                      setOpenMenu(null)
                    }}
                  >
                    <span>{item.label}</span>
                    {item.shortcut && (
                      <span className="ml-4 text-[10px] text-muted-foreground">
                        {item.shortcut}
                      </span>
                    )}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/uxderrick-mac/Development/Manna
export PATH="$HOME/.bun/bin:$PATH"
bun run typecheck
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/menu-bar.tsx
git commit -m "feat: add custom in-app menu bar component"
```

---

## Task 8: Toolbar Component

**Files:**
- Create: `src/components/layout/toolbar.tsx`

- [ ] **Step 1: Create the toolbar**

Create `src/components/layout/toolbar.tsx`:

```tsx
import { useState, useEffect } from "react"
import { useTheme } from "@/components/theme-provider"
import { useAudioStore, useTranscriptStore, useSessionStore, useBroadcastStore } from "@/stores"
import { useSession } from "@/hooks/use-session"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { LevelMeter } from "@/components/ui/level-meter"
import { LiveIndicator } from "@/components/ui/live-indicator"
import { SettingsDialog } from "@/components/settings-dialog"
import { Sun, Moon, GearSix, Broadcast } from "@phosphor-icons/react"

export function Toolbar() {
  const { theme, setTheme } = useTheme()
  const audioLevel = useAudioStore((s) => s.level)
  const isTranscribing = useTranscriptStore((s) => s.isTranscribing)
  const activeSession = useSessionStore((s) => s.activeSession)
  const isLive = useBroadcastStore((s) => s.isLive)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [elapsed, setElapsed] = useState("00:00:00")

  // Session timer
  useEffect(() => {
    if (!activeSession?.startedAt || activeSession.status !== "live") {
      setElapsed("00:00:00")
      return
    }
    const start = new Date(activeSession.startedAt).getTime()
    const interval = setInterval(() => {
      const diff = Date.now() - start
      const h = Math.floor(diff / 3600000)
        .toString()
        .padStart(2, "0")
      const m = Math.floor((diff % 3600000) / 60000)
        .toString()
        .padStart(2, "0")
      const s = Math.floor((diff % 60000) / 1000)
        .toString()
        .padStart(2, "0")
      setElapsed(`${h}:${m}:${s}`)
    }, 1000)
    return () => clearInterval(interval)
  }, [activeSession?.startedAt, activeSession?.status])

  return (
    <div
      data-slot="toolbar"
      className="flex h-[var(--toolbar-height)] items-center justify-between border-b border-border bg-card px-3"
    >
      {/* Left: Session info */}
      <div className="flex items-center gap-3">
        {activeSession?.status === "live" && <LiveIndicator />}
        {activeSession ? (
          <>
            <span className="text-sm font-medium text-foreground">
              {activeSession.title}
            </span>
            {activeSession.status === "live" && (
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {elapsed}
              </span>
            )}
            <Badge
              variant={activeSession.status === "live" ? "default" : "outline"}
              className="text-[10px] uppercase"
            >
              {activeSession.status}
            </Badge>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">No active session</span>
        )}
      </div>

      {/* Right: Audio + Controls */}
      <div className="flex items-center gap-2">
        {isTranscribing && audioLevel && (
          <LevelMeter rms={audioLevel.rms} peak={audioLevel.peak} />
        )}

        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => setSettingsOpen(true)}
        >
          <GearSix size={16} />
        </Button>

        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/uxderrick-mac/Development/Manna
export PATH="$HOME/.bun/bin:$PATH"
bun run typecheck
```

Expected: May have minor type errors if `SettingsDialog` doesn't accept `open`/`onOpenChange` props. Fix by checking the existing SettingsDialog component interface — it may use internal state. If so, keep the existing pattern (button that opens dialog internally) and simplify the toolbar accordingly.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/toolbar.tsx
git commit -m "feat: add toolbar component with session timer and audio meter"
```

---

## Task 9: Panel Tabs Component

**Files:**
- Create: `src/components/layout/panel-tabs.tsx`

- [ ] **Step 1: Create the panel tabs component**

Create `src/components/layout/panel-tabs.tsx`:

```tsx
import { useState } from "react"

export interface PanelTab {
  id: string
  label: string
  icon?: React.ReactNode
  content: React.ReactNode
}

interface PanelTabsProps {
  tabs: PanelTab[]
  defaultTab?: string
  className?: string
}

export function PanelTabs({ tabs, defaultTab, className }: PanelTabsProps) {
  const [activeTab, setActiveTab] = useState(defaultTab ?? tabs[0]?.id ?? "")
  const active = tabs.find((t) => t.id === activeTab) ?? tabs[0]

  return (
    <div className={`flex min-h-0 flex-col ${className ?? ""}`}>
      {/* Tab bar */}
      <div className="flex shrink-0 items-center gap-0.5 border-b border-border bg-muted/30 px-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            data-active={tab.id === activeTab || undefined}
            className="flex items-center gap-1.5 border-b-2 border-transparent px-2.5 py-1.5 text-xs text-muted-foreground transition-colors duration-[var(--duration-fast)] hover:text-foreground data-[active]:border-primary data-[active]:text-foreground"
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-auto">
        {active?.content}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/uxderrick-mac/Development/Manna
export PATH="$HOME/.bun/bin:$PATH"
bun run typecheck
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/panel-tabs.tsx
git commit -m "feat: add panel tabs component for workspace layout"
```

---

## Task 10: Workspace Layout

**Files:**
- Create: `src/components/layout/workspace.tsx`
- Modify: `src/App.tsx`
- Modify: `src/main.tsx`

- [ ] **Step 1: Create the workspace layout**

Create `src/components/layout/workspace.tsx`:

```tsx
import { useState } from "react"
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from "react-resizable-panels"
import { MenuBar } from "./menu-bar"
import { Toolbar } from "./toolbar"
import { PanelTabs } from "./panel-tabs"

// Existing panels — imported as tab contents
import { TranscriptPanel } from "@/components/panels/transcript-panel"
import { SearchPanel } from "@/components/panels/search-panel"
import { DetectionsPanel } from "@/components/panels/detections-panel"
import { PreviewPanel } from "@/components/panels/preview-panel"
import { QueuePanel } from "@/components/panels/queue-panel"

function ResizeHandle({ className }: { className?: string }) {
  return (
    <PanelResizeHandle
      className={`group relative flex w-1 items-center justify-center transition-colors duration-[var(--duration-fast)] hover:bg-primary/20 ${className ?? ""}`}
    >
      <div className="h-8 w-0.5 rounded-full bg-border transition-colors duration-[var(--duration-fast)] group-hover:bg-primary/50" />
    </PanelResizeHandle>
  )
}

function HorizontalResizeHandle() {
  return (
    <PanelResizeHandle
      className="group relative flex h-1 items-center justify-center transition-colors duration-[var(--duration-fast)] hover:bg-primary/20"
    >
      <div className="h-0.5 w-8 rounded-full bg-border transition-colors duration-[var(--duration-fast)] group-hover:bg-primary/50" />
    </PanelResizeHandle>
  )
}

export function Workspace() {
  const [transcriptExpanded, setTranscriptExpanded] = useState(false)

  const leftTabs = [
    { id: "search", label: "Search", content: <SearchPanel /> },
    { id: "notes", label: "Notes", content: <div className="p-3 text-sm text-muted-foreground">Notes — coming in Wave 2</div> },
    { id: "songs", label: "Songs", content: <div className="p-3 text-sm text-muted-foreground">Songs — coming in Wave 3</div> },
  ]

  const centerTabs = [
    { id: "detections", label: "Detections", content: <DetectionsPanel /> },
    { id: "preview", label: "Broadcast", content: <PreviewPanel /> },
    { id: "analytics", label: "Analytics", content: <div className="p-3 text-sm text-muted-foreground">Analytics — coming in Wave 2</div> },
  ]

  const rightTabs = [
    { id: "queue", label: "Queue", content: <QueuePanel /> },
    { id: "crossrefs", label: "Cross-refs", content: <div className="p-3 text-sm text-muted-foreground">Cross-references — coming in Wave 2</div> },
    { id: "planner", label: "Planner", content: <div className="p-3 text-sm text-muted-foreground">Planner — coming in Wave 2</div> },
  ]

  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      {/* Menu Bar */}
      <MenuBar />

      {/* Toolbar */}
      <Toolbar />

      {/* Main workspace */}
      <div className="flex min-h-0 flex-1">
        <PanelGroup direction="horizontal" autoSaveId="manna-workspace-h">
          {/* Left Panel */}
          <Panel defaultSize={22} minSize={15} maxSize={35}>
            <PanelTabs tabs={leftTabs} defaultTab="search" className="h-full" />
          </Panel>

          <ResizeHandle />

          {/* Center + Bottom */}
          <Panel defaultSize={50} minSize={30}>
            <PanelGroup direction="vertical" autoSaveId="manna-workspace-v">
              {/* Center Panel */}
              <Panel defaultSize={transcriptExpanded ? 65 : 85} minSize={40}>
                <PanelTabs tabs={centerTabs} defaultTab="detections" className="h-full" />
              </Panel>

              <HorizontalResizeHandle />

              {/* Bottom: Transcript */}
              <Panel
                defaultSize={transcriptExpanded ? 35 : 15}
                minSize={8}
                maxSize={50}
                collapsible
                collapsedSize={8}
                onCollapse={() => setTranscriptExpanded(false)}
                onExpand={() => setTranscriptExpanded(true)}
              >
                <div className="flex h-full flex-col">
                  <button
                    className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setTranscriptExpanded(!transcriptExpanded)}
                  >
                    <span
                      className="transition-transform duration-[var(--duration-fast)]"
                      style={{ transform: transcriptExpanded ? "rotate(0)" : "rotate(-90deg)" }}
                    >
                      ▼
                    </span>
                    Transcript
                  </button>
                  <div className="min-h-0 flex-1 overflow-auto">
                    <TranscriptPanel />
                  </div>
                </div>
              </Panel>
            </PanelGroup>
          </Panel>

          <ResizeHandle />

          {/* Right Panel */}
          <Panel defaultSize={28} minSize={15} maxSize={40}>
            <PanelTabs tabs={rightTabs} defaultTab="queue" className="h-full" />
          </Panel>
        </PanelGroup>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Update App.tsx to use Workspace**

Replace `src/App.tsx` with:

```tsx
import { Workspace } from "@/components/layout/workspace"
import { useRemoteControl } from "@/hooks/use-remote-control"
import { TutorialOverlay } from "@/components/tutorial/tutorial-overlay"
import { Toaster } from "sonner"

export function App() {
  useRemoteControl()
  return (
    <>
      <Workspace />
      <TutorialOverlay />
      <Toaster position="top-right" />
    </>
  )
}

export default App
```

Note: Changed Toaster position from `bottom-right` to `top-right` to match design DNA.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/uxderrick-mac/Development/Manna
export PATH="$HOME/.bun/bin:$PATH"
bun run typecheck
```

Expected: No errors. If there are errors related to existing panel components (they may expect certain parent layouts), fix the imports or wrap them appropriately.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/workspace.tsx src/App.tsx
git commit -m "feat: replace dashboard with workspace layout — menu bar, toolbar, 3 resizable panels with tabs, collapsible transcript"
```

---

## Task 11: Integration Test — Full Rust Build

**Files:** None (verification only)

- [ ] **Step 1: Full Rust workspace build**

```bash
cd /Users/uxderrick-mac/Development/Manna/src-tauri
export PATH="$HOME/.cargo/bin:$PATH"
cargo build
```

Expected: Full build succeeds. If there are linker errors related to NDI or system libraries, those are pre-existing and not related to our changes.

- [ ] **Step 2: Full frontend typecheck**

```bash
cd /Users/uxderrick-mac/Development/Manna
export PATH="$HOME/.bun/bin:$PATH"
bun run typecheck
```

Expected: No errors.

- [ ] **Step 3: Run existing tests**

```bash
bun run test -- --run
```

Expected: Existing tests pass. New code doesn't have frontend tests yet (they'll come with feature implementation in Wave 2).

---

## Task 12: Smoke Test — Run the App

**Files:** None (verification only)

- [ ] **Step 1: Run the Tauri dev server**

```bash
cd /Users/uxderrick-mac/Development/Manna
export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$PATH"
bun run tauri dev
```

Expected: App launches with:
- Menu bar at top (~28px) with Manna, Session, Broadcast, View, Help
- Toolbar below (~40px) with "No active session" text
- Three resizable panels: Search (left), Detections (center), Queue (right)
- Collapsible transcript bar at the bottom of the center panel
- All existing functionality (search, detection, queue, broadcast) still works through the tabs

- [ ] **Step 2: Test panel resizing**

Drag the resize handles between panels. Verify panels resize smoothly and persist their sizes across app restarts (via `autoSaveId`).

- [ ] **Step 3: Test menu bar**

Click each menu (Manna, Session, Broadcast, View, Help). Verify dropdowns appear and close. Test "Dark Mode" / "Light Mode" toggle in View menu.

- [ ] **Step 4: Test collapsible transcript**

Click the "Transcript" bar at the bottom. Verify it expands and collapses.

---

## Summary

| Task | Description | Estimated Complexity |
|------|-------------|---------------------|
| 1 | Install dependencies | Simple |
| 2 | Rust session types | Medium |
| 3 | Session database layer | Medium |
| 4 | Tauri commands | Medium |
| 5 | Frontend types + store + hook | Simple |
| 6 | Design system tokens | Simple |
| 7 | Menu bar component | Medium |
| 8 | Toolbar component | Medium |
| 9 | Panel tabs component | Simple |
| 10 | Workspace layout | Medium |
| 11 | Integration test — Rust build | Verification |
| 12 | Smoke test — run the app | Verification |
