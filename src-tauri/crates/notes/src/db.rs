use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::error::{Result, SessionError};
use crate::models::{
    AddDetectionRequest, AddDistributionRequest, AddNoteRequest, AddTranscriptRequest,
    CreateSessionRequest, PlannedScripture, SermonSession, SessionDetection, SessionDistribution,
    SessionNote, SessionStatus,
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

    pub(crate) fn conn(&self) -> &Connection {
        &self.conn
    }

    pub(crate) fn conn_mut(&mut self) -> &mut Connection {
        &mut self.conn
    }

    /// Run schema migrations, creating tables if they do not exist.
    fn migrate(&self) -> Result<()> {
        // WAL improves concurrent reads during long-running transcript writes;
        // NORMAL sync still fsyncs at checkpoint but skips per-commit fsync.
        // busy_timeout prevents transient SQLITE_BUSY when multiple commands
        // contend (we serialise via Mutex, but other handles may exist).
        self.conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA busy_timeout = 5000;",
        )?;

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

            CREATE TABLE IF NOT EXISTS session_sharing_drafts (
                session_id INTEGER PRIMARY KEY REFERENCES sermon_sessions(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                recap TEXT NOT NULL,
                sms TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS session_publications (
                session_id INTEGER PRIMARY KEY REFERENCES sermon_sessions(id) ON DELETE CASCADE,
                publication_id TEXT NOT NULL UNIQUE,
                url TEXT,
                published_at TEXT
            );

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

            CREATE TABLE IF NOT EXISTS service_plan_templates (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                name        TEXT    NOT NULL,
                notes       TEXT,
                created_at  INTEGER NOT NULL,
                updated_at  INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS service_plan_items (
                id                      INTEGER PRIMARY KEY AUTOINCREMENT,
                plan_id                 INTEGER NOT NULL,
                plan_kind               TEXT    NOT NULL CHECK (plan_kind IN ('template','session')),
                order_index             REAL    NOT NULL,
                item_type               TEXT    NOT NULL CHECK (item_type IN ('verse','song','announcement','section','blank','momo','jesus','notes')),
                item_data               TEXT    NOT NULL,
                auto_advance_seconds    INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_plan_items_scope ON service_plan_items (plan_id, plan_kind, order_index);

            CREATE TRIGGER IF NOT EXISTS trg_plan_items_session_cascade
            AFTER DELETE ON sermon_sessions
            BEGIN
                DELETE FROM service_plan_items
                WHERE plan_id = OLD.id AND plan_kind = 'session';
            END;
            ",
        )?;

        // Add songs metadata columns idempotently. SQLite can't ADD COLUMN IF NOT
        // EXISTS, so attempts will fail on re-runs after the column is present —
        // that's expected, ignore the error.
        let add_col = |sql: &str| {
            let _ = self.conn.execute(sql, []);
        };
        add_col("ALTER TABLE songs ADD COLUMN tune TEXT");
        add_col("ALTER TABLE songs ADD COLUMN meter TEXT");
        add_col("ALTER TABLE songs ADD COLUMN scripture_ref TEXT");
        add_col("ALTER TABLE songs ADD COLUMN category TEXT");

        // Per-session audio recording path. Idempotent ADD COLUMN — error ignored on
        // re-runs once the column is present (SQLite has no IF NOT EXISTS for ADD COLUMN).
        add_col("ALTER TABLE sermon_sessions ADD COLUMN audio_path TEXT");
        self.conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_songs_scripture ON songs(scripture_ref);",
        )?;

        // Migrate older EasyWorship imports from stanza-full → stanza-pair (new default).
        // Idempotent: only updates rows that still have stanza-full.
        let _ = self.conn.execute(
            "UPDATE songs SET data = json_set(data, '$.lineMode', 'stanza-pair') \
             WHERE source = 'easyworship' AND json_extract(data, '$.lineMode') = 'stanza-full'",
            [],
        );

        // Widen service_plan_items.item_type CHECK to include momo/jesus.
        // SQLite cannot ALTER a CHECK constraint, so rebuild the table when the
        // current schema does not list the new variants.
        let needs_rebuild: bool = {
            let mut stmt = self.conn.prepare(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='service_plan_items'",
            )?;
            let sql: Option<String> = stmt.query_row([], |r| r.get(0)).ok();
            match sql {
                Some(s) => !s.contains("'momo'") || !s.contains("'jesus'") || !s.contains("'notes'"),
                None => false,
            }
        };
        if needs_rebuild {
            self.conn.execute_batch(
                "
                BEGIN;
                DROP TRIGGER IF EXISTS trg_plan_items_session_cascade;
                ALTER TABLE service_plan_items RENAME TO service_plan_items_old;
                CREATE TABLE service_plan_items (
                    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
                    plan_id                 INTEGER NOT NULL,
                    plan_kind               TEXT    NOT NULL CHECK (plan_kind IN ('template','session')),
                    order_index             REAL    NOT NULL,
                    item_type               TEXT    NOT NULL CHECK (item_type IN ('verse','song','announcement','section','blank','momo','jesus','notes')),
                    item_data               TEXT    NOT NULL,
                    auto_advance_seconds    INTEGER
                );
                INSERT INTO service_plan_items (id, plan_id, plan_kind, order_index, item_type, item_data, auto_advance_seconds)
                SELECT id, plan_id, plan_kind, order_index, item_type, item_data, auto_advance_seconds
                FROM service_plan_items_old;
                DROP TABLE service_plan_items_old;
                CREATE INDEX IF NOT EXISTS idx_plan_items_scope ON service_plan_items (plan_id, plan_kind, order_index);
                CREATE TRIGGER IF NOT EXISTS trg_plan_items_session_cascade
                AFTER DELETE ON sermon_sessions
                BEGIN
                    DELETE FROM service_plan_items
                    WHERE plan_id = OLD.id AND plan_kind = 'session';
                END;
                COMMIT;
                ",
            )?;
        }

        let has_title_source: bool = self.conn.prepare("PRAGMA table_info(sermon_sessions)")?
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<rusqlite::Result<Vec<_>>>()?.iter().any(|name| name == "title_source");
        if !has_title_source {
            // Existing names are protected; their origin cannot be inferred safely.
            self.conn.execute("ALTER TABLE sermon_sessions ADD COLUMN title_source TEXT NOT NULL DEFAULT 'manual'", [])?;
        }
        self.migrate_session_slides()?;
        self.migrate_song_fingerprints()?;
        Ok(())
    }

    // ── Session CRUD ────────────────────────────────────────────────

    /// Create a new sermon session in Planned status.
    pub fn create_session(&self, req: &CreateSessionRequest) -> Result<SermonSession> {
        let tags_json = serde_json::to_string(&req.tags)?;
        let scriptures_json = serde_json::to_string(&req.planned_scriptures)?;

        self.conn.execute(
            "INSERT INTO sermon_sessions (title, speaker, date, series_name, tags, planned_scriptures, title_source)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                req.title,
                req.speaker,
                req.date,
                req.series_name,
                tags_json,
                scriptures_json,
                if req.title_is_automatic { "default" } else { "manual" },
            ],
        )?;

        let id = self.conn.last_insert_rowid();
        self.get_session(id)
    }

    /// Retrieve a single session by id.
    pub fn get_session(&self, id: i64) -> Result<SermonSession> {
        let parsed = self
            .conn
            .query_row(
                "SELECT * FROM sermon_sessions WHERE id = ?1",
                params![id],
                |row| Ok(row_to_session(row)),
            )
            .optional()?;
        match parsed {
            Some(Ok(session)) => Ok(session),
            Some(Err(e)) => Err(SessionError::Serialization(e)),
            None => Err(SessionError::NotFound(id.to_string())),
        }
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

    /// Save an operator name and protect it from automatic naming.
    pub fn update_session_title(&self, id: i64, title: &str) -> Result<()> {
        let changed = self.conn.execute(
            "UPDATE sermon_sessions SET title = ?1, title_source = 'manual', updated_at = datetime('now') WHERE id = ?2",
            params![title, id],
        )?;
        if changed == 0 {
            return Err(SessionError::NotFound(id.to_string()));
        }
        Ok(())
    }

    /// Apply a verified announcement only if the original automatic name is still live.
    pub fn apply_announced_title(&self, id: i64, expected_title: &str, title: &str, expected_context: &str) -> Result<bool> {
        if self.recent_title_transcript(id)? != expected_context { return Ok(false); }
        Ok(self.conn.execute(
            "UPDATE sermon_sessions SET title = ?1, title_source = 'announced', updated_at = datetime('now')
             WHERE id = ?2 AND status = 'live' AND title_source = 'default' AND title = ?3",
            params![title, id, expected_title],
        )? == 1)
    }

    /// Read only a bounded tail for a possible live title announcement.
    pub fn recent_title_transcript(&self, id: i64) -> Result<String> {
        let mut stmt = self.conn.prepare(
            "SELECT substr(text, -2000) FROM session_transcript WHERE session_id = ?1 AND is_final = 1 ORDER BY id DESC LIMIT 6"
        )?;
        let mut parts = stmt.query_map([id], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        parts.reverse();
        let joined = parts.join(" ");
        let start = joined.char_indices().rev().nth(1999).map_or(0, |(i, _)| i);
        Ok(joined[start..].to_string())
    }

    /// Update series_name. Empty string clears (stores NULL).
    pub fn update_session_series(&self, id: i64, series: Option<&str>) -> Result<()> {
        let series = series.and_then(|s| {
            let t = s.trim();
            if t.is_empty() { None } else { Some(t.to_string()) }
        });
        let changed = self.conn.execute(
            "UPDATE sermon_sessions SET series_name = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![series, id],
        )?;
        if changed == 0 {
            return Err(SessionError::NotFound(id.to_string()));
        }
        Ok(())
    }

    /// Update tags. Pass a JSON array string ("[\"tag1\",\"tag2\"]") — stored as-is.
    pub fn update_session_tags(&self, id: i64, tags_json: &str) -> Result<()> {
        let changed = self.conn.execute(
            "UPDATE sermon_sessions SET tags = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![tags_json, id],
        )?;
        if changed == 0 {
            return Err(SessionError::NotFound(id.to_string()));
        }
        Ok(())
    }

    /// Update a single transcript segment's text. Used by inline editor on the
    /// session detail page so operators can clean STT errors after the fact.
    pub fn update_transcript_segment(&self, segment_id: i64, text: &str) -> Result<()> {
        let changed = self.conn.execute(
            "UPDATE session_transcript SET text = ?1 WHERE id = ?2",
            params![text, segment_id],
        )?;
        if changed == 0 {
            return Err(SessionError::NotFound(segment_id.to_string()));
        }
        Ok(())
    }

    /// Delete a single transcript segment (e.g. blank lines, false starts).
    pub fn delete_transcript_segment(&self, segment_id: i64) -> Result<()> {
        let changed = self.conn.execute(
            "DELETE FROM session_transcript WHERE id = ?1",
            params![segment_id],
        )?;
        if changed == 0 {
            return Err(SessionError::NotFound(segment_id.to_string()));
        }
        Ok(())
    }

    /// Distinct list of series names already used. Empty/null filtered.
    pub fn list_session_series(&self) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT series_name FROM sermon_sessions
             WHERE series_name IS NOT NULL AND TRIM(series_name) != ''
             ORDER BY series_name COLLATE NOCASE",
        )?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut out = Vec::new();
        for r in rows {
            if let Ok(s) = r {
                out.push(s);
            }
        }
        Ok(out)
    }

    pub fn update_session_summary(&self, id: i64, summary: &str) -> Result<()> {
        let changed = self.conn.execute(
            "UPDATE sermon_sessions SET summary = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![summary, id],
        )?;

        if changed == 0 {
            return Err(SessionError::NotFound(id.to_string()));
        }
        Ok(())
    }

    /// Persist the absolute path to a session's recorded MP3.
    pub fn set_session_audio_path(&self, id: i64, path: &str) -> Result<()> {
        let changed = self.conn.execute(
            "UPDATE sermon_sessions SET audio_path = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![path, id],
        )?;
        if changed == 0 {
            return Err(SessionError::NotFound(id.to_string()));
        }
        Ok(())
    }

    /// Clear the `audio_path` for a session (after the file is deleted).
    pub fn clear_session_audio_path(&self, id: i64) -> Result<()> {
        let changed = self.conn.execute(
            "UPDATE sermon_sessions SET audio_path = NULL, updated_at = datetime('now') WHERE id = ?1",
            params![id],
        )?;
        if changed == 0 {
            return Err(SessionError::NotFound(id.to_string()));
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
            return Err(SessionError::NotFound(id.to_string()));
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

    /// Record that a verse went on-screen during a session.
    /// Marks the most recent matching detection as presented if one exists,
    /// otherwise inserts a new manual detection row already flagged presented.
    pub fn record_presented_verse(
        &self,
        session_id: i64,
        verse_ref: &str,
        verse_text: &str,
        translation: &str,
    ) -> Result<()> {
        let existing_id: Option<i64> = self
            .conn
            .query_row(
                "SELECT id FROM session_detections
                 WHERE session_id = ?1 AND verse_ref = ?2
                 ORDER BY detected_at DESC LIMIT 1",
                params![session_id, verse_ref],
                |r| r.get(0),
            )
            .optional()?;

        if let Some(id) = existing_id {
            self.conn.execute(
                "UPDATE session_detections SET was_presented = 1 WHERE id = ?1",
                params![id],
            )?;
        } else {
            self.conn.execute(
                "INSERT INTO session_detections
                   (session_id, verse_ref, verse_text, translation, confidence, source, transcript_snippet, was_presented)
                 VALUES (?1, ?2, ?3, ?4, 1.0, 'manual', NULL, 1)",
                params![session_id, verse_ref, verse_text, translation],
            )?;
        }
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

    /// Update a note's content in place.
    pub fn update_note(&self, id: i64, content: &str) -> Result<()> {
        let changed = self.conn.execute(
            "UPDATE session_notes SET content = ?1 WHERE id = ?2",
            params![content, id],
        )?;
        if changed == 0 {
            return Err(SessionError::NotFound(id.to_string()));
        }
        Ok(())
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

    // ── Distributions ───────────────────────────────────────────────

    /// Record a distribution attempt. Status starts as `pending`; advance it
    /// later with `mark_distribution_sent` / `mark_distribution_failed`.
    pub fn add_distribution(
        &self,
        req: &AddDistributionRequest,
    ) -> Result<SessionDistribution> {
        self.conn.execute(
            "INSERT INTO session_distributions (session_id, channel, recipient) \
             VALUES (?1, ?2, ?3)",
            params![req.session_id, req.channel, req.recipient],
        )?;

        let id = self.conn.last_insert_rowid();
        self.conn
            .query_row(
                "SELECT id, session_id, channel, recipient, sent_at, status \
                 FROM session_distributions WHERE id = ?1",
                params![id],
                row_to_distribution,
            )
            .map_err(Into::into)
    }

    /// List distributions for a session, newest first.
    pub fn list_distributions(&self, session_id: i64) -> Result<Vec<SessionDistribution>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, session_id, channel, recipient, sent_at, status \
             FROM session_distributions WHERE session_id = ?1 ORDER BY id DESC",
        )?;
        let rows = stmt.query_map(params![session_id], row_to_distribution)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// Mark distribution as sent and stamp `sent_at = now`.
    pub fn mark_distribution_sent(&self, id: i64) -> Result<()> {
        self.conn.execute(
            "UPDATE session_distributions \
             SET status = 'sent', sent_at = datetime('now') WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    }

    /// Mark distribution as failed; preserve sent_at for re-try diagnostics.
    pub fn mark_distribution_failed(&self, id: i64) -> Result<()> {
        self.conn.execute(
            "UPDATE session_distributions SET status = 'failed' WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    }

    pub fn delete_distribution(&self, id: i64) -> Result<()> {
        self.conn.execute(
            "DELETE FROM session_distributions WHERE id = ?1",
            params![id],
        )?;
        Ok(())
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

    #[allow(clippy::type_complexity)]
    #[allow(clippy::type_complexity)]
    pub fn list_songs(
        &self,
    ) -> Result<Vec<(
        String, String, Option<i64>, String, Option<String>, String,
        Option<String>, Option<String>, Option<String>, Option<String>,
        String,
    )>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, source, number, title, author, data,
                    tune, meter, scripture_ref, category, created_at
             FROM songs ORDER BY source, number, title",
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
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, Option<String>>(8)?,
                    row.get::<_, Option<String>>(9)?,
                    row.get::<_, String>(10)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    #[allow(clippy::type_complexity)]
    pub fn get_song(
        &self,
        id: &str,
    ) -> Result<(
        String, String, Option<i64>, String, Option<String>, String,
        Option<String>, Option<String>, Option<String>, Option<String>,
        String,
    )> {
        Ok(self.conn.query_row(
            "SELECT id, source, number, title, author, data,
                    tune, meter, scripture_ref, category, created_at
             FROM songs WHERE id = ?1",
            params![id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, Option<String>>(8)?,
                    row.get::<_, Option<String>>(9)?,
                    row.get::<_, String>(10)?,
                ))
            },
        )?)
    }

    #[allow(clippy::too_many_arguments)]
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
        self.save_song_with_meta(
            id, source, number, title, author, data, seed_version,
            None, None, None, None,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn save_song_with_meta(
        &self,
        id: &str,
        source: &str,
        number: Option<i64>,
        title: &str,
        author: Option<&str>,
        data: &str,
        seed_version: i64,
        tune: Option<&str>,
        meter: Option<&str>,
        scripture_ref: Option<&str>,
        category: Option<&str>,
    ) -> Result<()> {
        self.conn.execute(
            "INSERT INTO songs (id, source, number, title, author, data, seed_version, tune, meter, scripture_ref, category)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(id) DO UPDATE SET
                source = ?2, number = ?3, title = ?4, author = ?5,
                data = ?6, seed_version = ?7,
                tune = ?8, meter = ?9, scripture_ref = ?10, category = ?11,
                updated_at = datetime('now')",
            params![id, source, number, title, author, data, seed_version,
                    tune, meter, scripture_ref, category],
        )?;
        Ok(())
    }

    pub fn delete_song(&self, id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM songs WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn delete_songs_by_source(&self, source: &str) -> Result<usize> {
        let n = self.conn.execute("DELETE FROM songs WHERE source = ?1", params![source])?;
        Ok(n)
    }

    pub fn count_songs_by_source(&self, source: &str) -> Result<i64> {
        let n: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM songs WHERE source = ?1",
            params![source],
            |row| row.get(0),
        )?;
        Ok(n)
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

    pub fn max_hymnal_seed_version(&self, source: &str) -> Result<i64> {
        let v: i64 = self.conn.query_row(
            "SELECT COALESCE(MAX(seed_version), 0) FROM songs WHERE source = ?1",
            params![source],
            |row| row.get(0),
        )?;
        Ok(v)
    }

    /// Deprecated wrapper — use `max_hymnal_seed_version("ghs")` directly.
    pub fn max_ghs_seed_version(&self) -> Result<i64> {
        self.max_hymnal_seed_version("ghs")
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
                    status, planned_scriptures, summary, created_at, updated_at, audio_path
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

    // `audio_path` was added by a later migration; tolerate the column being
    // absent in legacy rows by treating a missing read as `None`.
    let audio_path: Option<String> = row.get(13).ok().flatten();

    Ok(SermonSession {
        id: row.get_unwrap(0),
        title: row.get_unwrap(1),
        title_source: row.get_unwrap("title_source"),
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
        audio_path,
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

fn row_to_distribution(row: &Row<'_>) -> rusqlite::Result<SessionDistribution> {
    Ok(SessionDistribution {
        id: row.get(0)?,
        session_id: row.get(1)?,
        channel: row.get(2)?,
        recipient: row.get(3)?,
        sent_at: row.get(4)?,
        status: row.get(5)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::CreateSessionRequest;

    #[test]
    fn audio_path_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let db = SessionDb::open(&dir.path().join("test.db")).unwrap();
        let session = db
            .create_session(&CreateSessionRequest {
                title_is_automatic: false,
                title: "Test".into(),
                speaker: None,
                date: "2026-05-28".into(),
                series_name: None,
                tags: vec![],
                planned_scriptures: vec![],
            })
            .unwrap();
        assert_eq!(session.audio_path, None);

        db.set_session_audio_path(session.id, "/tmp/x.mp3").unwrap();
        let reloaded = db.get_session(session.id).unwrap();
        assert_eq!(reloaded.audio_path, Some("/tmp/x.mp3".into()));

        db.clear_session_audio_path(session.id).unwrap();
        let cleared = db.get_session(session.id).unwrap();
        assert_eq!(cleared.audio_path, None);
    }
}
