use std::path::Path;

use rusqlite::{params, Connection, Row};

use crate::error::{Result, SessionError};
use crate::models::{
    AddDetectionRequest, AddNoteRequest, AddTranscriptRequest, CreateSessionRequest,
    PlannedScripture, SermonSession, SessionDetection, SessionNote, SessionStatus,
    SessionTranscriptSegment,
};

/// Database handle for sermon session persistence.
pub struct SessionDb {
    conn: Connection,
}

impl SessionDb {
    /// Open (or create) the database at the given path and run migrations.
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        let db = Self { conn };
        db.migrate()?;
        Ok(db)
    }

    /// Run schema migrations, creating tables if they do not exist.
    fn migrate(&self) -> Result<()> {
        self.conn.execute_batch("PRAGMA foreign_keys = ON;")?;

        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS sermon_sessions (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                title           TEXT    NOT NULL,
                speaker         TEXT,
                date            TEXT    NOT NULL,
                series_name     TEXT,
                tags            TEXT    NOT NULL DEFAULT '[]',
                started_at      TEXT,
                ended_at        TEXT,
                status          TEXT    NOT NULL DEFAULT 'planned',
                planned_scriptures TEXT NOT NULL DEFAULT '[]',
                summary         TEXT,
                created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
                updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS session_detections (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id          INTEGER NOT NULL REFERENCES sermon_sessions(id) ON DELETE CASCADE,
                verse_ref           TEXT    NOT NULL,
                verse_text          TEXT    NOT NULL,
                translation         TEXT    NOT NULL,
                confidence          REAL    NOT NULL,
                source              TEXT    NOT NULL,
                detected_at         TEXT    NOT NULL DEFAULT (datetime('now')),
                was_presented       INTEGER NOT NULL DEFAULT 0,
                transcript_snippet  TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_detections_session ON session_detections(session_id);

            CREATE TABLE IF NOT EXISTS session_transcript (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id      INTEGER NOT NULL REFERENCES sermon_sessions(id) ON DELETE CASCADE,
                text            TEXT    NOT NULL,
                is_final        INTEGER NOT NULL DEFAULT 0,
                confidence      REAL    NOT NULL,
                timestamp_ms    INTEGER NOT NULL,
                speaker_label   TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_transcript_session ON session_transcript(session_id);

            CREATE TABLE IF NOT EXISTS session_notes (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id  INTEGER NOT NULL REFERENCES sermon_sessions(id) ON DELETE CASCADE,
                note_type   TEXT    NOT NULL,
                content     TEXT    NOT NULL,
                created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_notes_session ON session_notes(session_id);

            CREATE TABLE IF NOT EXISTS session_distributions (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id  INTEGER NOT NULL REFERENCES sermon_sessions(id) ON DELETE CASCADE,
                channel     TEXT    NOT NULL,
                recipient   TEXT    NOT NULL,
                sent_at     TEXT,
                status      TEXT    NOT NULL DEFAULT 'pending'
            );
            CREATE INDEX IF NOT EXISTS idx_distributions_session ON session_distributions(session_id);

            CREATE TABLE IF NOT EXISTS themes (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                data TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS songs (
                id TEXT PRIMARY KEY,
                source TEXT NOT NULL,
                number INTEGER,
                title TEXT NOT NULL,
                author TEXT,
                data TEXT NOT NULL,
                seed_version INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_songs_title ON songs(title);
            CREATE INDEX IF NOT EXISTS idx_songs_source_number ON songs(source, number);
            ",
        )?;

        Ok(())
    }

    // ── Session CRUD ────────────────────────────────────────────────

    /// Create a new sermon session in Planned status.
    pub fn create_session(&self, req: &CreateSessionRequest) -> Result<SermonSession> {
        let tags_json = serde_json::to_string(&req.tags)?;
        let scriptures_json = serde_json::to_string(&req.planned_scriptures)?;

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

    /// Retrieve a single session by id.
    pub fn get_session(&self, id: i64) -> Result<SermonSession> {
        self.conn
            .query_row(
                "SELECT * FROM sermon_sessions WHERE id = ?1",
                params![id],
                |row| Ok(row_to_session(row)),
            )?
            .map_err(|_| SessionError::NotFound(id))
    }

    /// List all sessions ordered by date descending.
    pub fn list_sessions(&self) -> Result<Vec<SermonSession>> {
        let mut stmt = self
            .conn
            .prepare("SELECT * FROM sermon_sessions ORDER BY date DESC")?;

        let rows = stmt.query_map([], |row| Ok(row_to_session(row)))?;

        let mut sessions = Vec::new();
        for r in rows {
            sessions.push(r?.map_err(|_| {
                SessionError::Serialization(serde_json::Error::io(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "Failed to deserialize session row",
                )))
            })?);
        }
        Ok(sessions)
    }

    /// Transition a session from Planned to Live, setting `started_at`.
    pub fn start_session(&self, id: i64) -> Result<SermonSession> {
        let session = self.get_session(id)?;
        if session.status != SessionStatus::Planned {
            return Err(SessionError::InvalidTransition {
                from: session.status.as_str().to_string(),
                to: "live".to_string(),
            });
        }

        self.conn.execute(
            "UPDATE sermon_sessions SET status = 'live', started_at = datetime('now'), updated_at = datetime('now') WHERE id = ?1",
            params![id],
        )?;

        self.get_session(id)
    }

    /// Transition a session from Live to Completed, setting `ended_at`.
    pub fn end_session(&self, id: i64) -> Result<SermonSession> {
        let session = self.get_session(id)?;
        if session.status != SessionStatus::Live {
            return Err(SessionError::InvalidTransition {
                from: session.status.as_str().to_string(),
                to: "completed".to_string(),
            });
        }

        self.conn.execute(
            "UPDATE sermon_sessions SET status = 'completed', ended_at = datetime('now'), updated_at = datetime('now') WHERE id = ?1",
            params![id],
        )?;

        self.get_session(id)
    }

    /// Update the AI-generated summary for a session.
    pub fn update_session_title(&self, id: i64, title: &str) -> Result<()> {
        let changed = self.conn.execute(
            "UPDATE sermon_sessions SET title = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![title, id],
        )?;
        if changed == 0 {
            return Err(SessionError::NotFound(id));
        }
        Ok(())
    }

    pub fn update_session_summary(&self, id: i64, summary: &str) -> Result<()> {
        let changed = self.conn.execute(
            "UPDATE sermon_sessions SET summary = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![summary, id],
        )?;

        if changed == 0 {
            return Err(SessionError::NotFound(id));
        }
        Ok(())
    }

    /// Delete a session and all associated data (cascades).
    pub fn delete_session(&self, id: i64) -> Result<()> {
        let changed = self.conn.execute(
            "DELETE FROM sermon_sessions WHERE id = ?1",
            params![id],
        )?;

        if changed == 0 {
            return Err(SessionError::NotFound(id));
        }
        Ok(())
    }

    // ── Detections ──────────────────────────────────────────────────

    /// Record a new verse detection for a session.
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
        self.conn.query_row(
            "SELECT * FROM session_detections WHERE id = ?1",
            params![id],
            row_to_detection,
        ).map_err(Into::into)
    }

    /// Mark a detection as having been presented/displayed.
    pub fn mark_detection_presented(&self, detection_id: i64) -> Result<()> {
        self.conn.execute(
            "UPDATE session_detections SET was_presented = 1 WHERE id = ?1",
            params![detection_id],
        )?;
        Ok(())
    }

    /// Get all detections for a session, ordered by detection time.
    pub fn get_session_detections(&self, session_id: i64) -> Result<Vec<SessionDetection>> {
        let mut stmt = self.conn.prepare(
            "SELECT * FROM session_detections WHERE session_id = ?1 ORDER BY detected_at ASC",
        )?;

        let rows = stmt.query_map(params![session_id], row_to_detection)?;

        let mut detections = Vec::new();
        for r in rows {
            detections.push(r?);
        }
        Ok(detections)
    }

    // ── Transcript ──────────────────────────────────────────────────

    /// Append a transcript segment for a session.
    pub fn add_transcript(&self, req: &AddTranscriptRequest) -> Result<()> {
        self.conn.execute(
            "INSERT INTO session_transcript (session_id, text, is_final, confidence, timestamp_ms, speaker_label)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                req.session_id,
                req.text,
                req.is_final,
                req.confidence,
                req.timestamp_ms,
                req.speaker_label,
            ],
        )?;
        Ok(())
    }

    /// Get all transcript segments for a session, ordered by timestamp.
    pub fn get_session_transcript(
        &self,
        session_id: i64,
    ) -> Result<Vec<SessionTranscriptSegment>> {
        let mut stmt = self.conn.prepare(
            "SELECT * FROM session_transcript WHERE session_id = ?1 ORDER BY timestamp_ms ASC",
        )?;

        let rows = stmt.query_map(params![session_id], row_to_transcript)?;

        let mut segments = Vec::new();
        for r in rows {
            segments.push(r?);
        }
        Ok(segments)
    }

    // ── Notes ───────────────────────────────────────────────────────

    /// Add a user note to a session.
    pub fn add_note(&self, req: &AddNoteRequest) -> Result<SessionNote> {
        self.conn.execute(
            "INSERT INTO session_notes (session_id, note_type, content) VALUES (?1, ?2, ?3)",
            params![req.session_id, req.note_type, req.content],
        )?;

        let id = self.conn.last_insert_rowid();
        self.conn.query_row(
            "SELECT * FROM session_notes WHERE id = ?1",
            params![id],
            row_to_note,
        ).map_err(Into::into)
    }

    /// Get all notes for a session, ordered by creation time.
    pub fn get_session_notes(&self, session_id: i64) -> Result<Vec<SessionNote>> {
        let mut stmt = self.conn.prepare(
            "SELECT * FROM session_notes WHERE session_id = ?1 ORDER BY created_at ASC",
        )?;

        let rows = stmt.query_map(params![session_id], row_to_note)?;

        let mut notes = Vec::new();
        for r in rows {
            notes.push(r?);
        }
        Ok(notes)
    }

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

    // ── Songs ─────────────────────────────────────────────────

    pub fn list_songs(
        &self,
    ) -> Result<Vec<(String, String, Option<i64>, String, Option<String>, String)>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, source, number, title, author, data FROM songs ORDER BY source, number, title",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, String>(5)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn get_song(
        &self,
        id: &str,
    ) -> Result<(String, String, Option<i64>, String, Option<String>, String)> {
        Ok(self.conn.query_row(
            "SELECT id, source, number, title, author, data FROM songs WHERE id = ?1",
            params![id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, String>(5)?,
                ))
            },
        )?)
    }

    pub fn save_song(
        &self,
        id: &str,
        source: &str,
        number: Option<i64>,
        title: &str,
        author: Option<&str>,
        data: &str,
        seed_version: i64,
    ) -> Result<()> {
        self.conn.execute(
            "INSERT INTO songs (id, source, number, title, author, data, seed_version)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
                source = ?2, number = ?3, title = ?4, author = ?5,
                data = ?6, seed_version = ?7, updated_at = datetime('now')",
            params![id, source, number, title, author, data, seed_version],
        )?;
        Ok(())
    }

    pub fn delete_song(&self, id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM songs WHERE id = ?1", params![id])?;
        Ok(())
    }

    // ── Transactions (for bulk seed idempotency) ──────────────

    pub fn begin_transaction(&self) -> Result<()> {
        self.conn.execute_batch("BEGIN")?;
        Ok(())
    }

    pub fn commit_transaction(&self) -> Result<()> {
        self.conn.execute_batch("COMMIT")?;
        Ok(())
    }

    pub fn rollback_transaction(&self) -> Result<()> {
        self.conn.execute_batch("ROLLBACK")?;
        Ok(())
    }

    pub fn max_ghs_seed_version(&self) -> Result<i64> {
        let v: i64 = self.conn.query_row(
            "SELECT COALESCE(MAX(seed_version), 0) FROM songs WHERE source = 'ghs'",
            [],
            |row| row.get(0),
        )?;
        Ok(v)
    }

    // ── Analytics ─────────────────────────────────────────────

    pub fn get_aggregate_stats(&self) -> Result<(i64, i64, f64, String)> {
        let total_sessions: i64 = self.conn
            .query_row("SELECT COUNT(*) FROM sermon_sessions WHERE status = 'completed'", [], |r| r.get(0))
            .unwrap_or(0);

        let total_detections: i64 = self.conn
            .query_row("SELECT COUNT(*) FROM session_detections", [], |r| r.get(0))
            .unwrap_or(0);

        let total_hours: f64 = self.conn
            .query_row(
                "SELECT COALESCE(SUM((julianday(ended_at) - julianday(started_at)) * 24), 0.0) FROM sermon_sessions WHERE status = 'completed' AND started_at IS NOT NULL AND ended_at IS NOT NULL",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0.0);

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
        let rows = stmt.query_map(params![limit], |row| Ok(row_to_session(row)))?;

        let mut sessions = Vec::new();
        for r in rows {
            sessions.push(r?.map_err(|_| {
                SessionError::Serialization(serde_json::Error::io(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "Failed to deserialize session row",
                )))
            })?);
        }
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
}

// ── Row-mapping helpers ─────────────────────────────────────────────

/// Map a database row to a `SermonSession`, deserializing JSON columns.
///
/// Returns `Err` only when JSON deserialization fails — column reads use
/// the infallible `rusqlite::Row` API and propagate through `?` in the
/// calling `query_row` / `query_map`.
fn row_to_session(row: &Row<'_>) -> std::result::Result<SermonSession, serde_json::Error> {
    let tags_str: String = row.get_unwrap(5);
    let scriptures_str: String = row.get_unwrap(9);
    let status_str: String = row.get_unwrap(8);

    let tags: Vec<String> = serde_json::from_str(&tags_str)?;
    let planned_scriptures: Vec<PlannedScripture> = serde_json::from_str(&scriptures_str)?;
    let status = SessionStatus::from_str(&status_str).unwrap_or(SessionStatus::Planned);

    Ok(SermonSession {
        id: row.get_unwrap(0),
        title: row.get_unwrap(1),
        speaker: row.get_unwrap(2),
        date: row.get_unwrap(3),
        series_name: row.get_unwrap(4),
        tags,
        started_at: row.get_unwrap(6),
        ended_at: row.get_unwrap(7),
        status,
        planned_scriptures,
        summary: row.get_unwrap(10),
        created_at: row.get_unwrap(11),
        updated_at: row.get_unwrap(12),
    })
}

fn row_to_detection(row: &Row<'_>) -> rusqlite::Result<SessionDetection> {
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
}

fn row_to_transcript(row: &Row<'_>) -> rusqlite::Result<SessionTranscriptSegment> {
    Ok(SessionTranscriptSegment {
        id: row.get(0)?,
        session_id: row.get(1)?,
        text: row.get(2)?,
        is_final: row.get::<_, i32>(3)? != 0,
        confidence: row.get(4)?,
        timestamp_ms: row.get(5)?,
        speaker_label: row.get(6)?,
    })
}

fn row_to_note(row: &Row<'_>) -> rusqlite::Result<SessionNote> {
    Ok(SessionNote {
        id: row.get(0)?,
        session_id: row.get(1)?,
        note_type: row.get(2)?,
        content: row.get(3)?,
        created_at: row.get(4)?,
    })
}
