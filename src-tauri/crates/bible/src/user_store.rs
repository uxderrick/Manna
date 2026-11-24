//! Writable store for Bibles imported by the user.
//!
//! The bundled database ships read-only inside the signed app bundle, so
//! imported Bibles live in a separate `SQLite` file with the same
//! `translations` / `books` / `verses` schema plus its own `verses_fts` index.
//! [`crate::BibleDb::open_with_user`] attaches it so every query sees both.
//!
//! Ids start high enough never to collide with bundled rows; see
//! [`USER_TRANSLATION_ID_START`] and friends.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Serialize;

use crate::error::BibleError;
use crate::import::ParsedBible;

/// First translation id used for imported Bibles.
pub const USER_TRANSLATION_ID_START: i64 = 1_000_000;
/// First book id used for imported Bibles.
pub const USER_BOOK_ID_START: i64 = 100_000_000;
/// First verse id used for imported Bibles.
pub const USER_VERSE_ID_START: i64 = 1_000_000_000;

/// Whether a translation id belongs to a user-imported Bible.
pub fn is_user_translation(translation_id: i64) -> bool {
    translation_id >= USER_TRANSLATION_ID_START
}

/// Whether a verse id belongs to a user-imported Bible.
pub fn is_user_verse(verse_id: i64) -> bool {
    verse_id >= USER_VERSE_ID_START
}

/// Copyright text stored as the license when the source has none.
pub const UNKNOWN_LICENSE: &str = "Imported";

const BUSY_TIMEOUT: Duration = Duration::from_secs(10);

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS translations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    abbreviation TEXT NOT NULL UNIQUE COLLATE NOCASE,
    title TEXT NOT NULL,
    language TEXT NOT NULL,
    license TEXT NOT NULL,
    is_copyrighted INTEGER NOT NULL DEFAULT 0,
    is_downloaded INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    translation_id INTEGER NOT NULL REFERENCES translations(id),
    book_number INTEGER NOT NULL,
    name TEXT NOT NULL,
    abbreviation TEXT NOT NULL,
    testament TEXT NOT NULL,
    UNIQUE(translation_id, book_number)
);
CREATE TABLE IF NOT EXISTS verses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    translation_id INTEGER NOT NULL REFERENCES translations(id),
    book_id INTEGER NOT NULL REFERENCES books(id),
    book_number INTEGER NOT NULL,
    book_name TEXT NOT NULL,
    book_abbreviation TEXT NOT NULL,
    chapter INTEGER NOT NULL,
    verse INTEGER NOT NULL,
    text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_verses_lookup ON verses(translation_id, book_number, chapter, verse);
CREATE INDEX IF NOT EXISTS idx_verses_chapter ON verses(translation_id, book_number, chapter);
-- Stores its own copy of the text (rowid = verses.id) so rows can be
-- replaced without the external-content bookkeeping the bundled index needs.
CREATE VIRTUAL TABLE IF NOT EXISTS verses_fts USING fts5(text, tokenize='unicode61');
";

/// Status of one Bible import.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BibleImportStatus {
    /// Added as a new translation.
    Imported,
    /// Replaced an earlier import with the same abbreviation (`overwrite`).
    Updated,
    /// An earlier import has the same abbreviation; nothing was written.
    SkippedExisting,
    /// Manna already ships a translation with this abbreviation; nothing was written.
    AlreadyInManna,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BibleImportReport {
    /// Id of the imported, updated or conflicting translation.
    pub translation_id: Option<i64>,
    pub title: String,
    pub abbreviation: String,
    pub language: String,
    pub status: BibleImportStatus,
    /// Books and verses in the parsed file (written only for `Imported`/`Updated`).
    pub books: usize,
    pub verses: usize,
    /// Books in the file outside the 66-book canon, which are never imported.
    pub skipped_books: Vec<String>,
}

/// Writable connection to the user Bible database.
///
/// Usable while the app holds the [`crate::BibleDb`]: it has its own
/// connection and lock, and the `BibleDb` sees committed imports immediately.
pub struct UserBibleStore {
    conn: Mutex<Connection>,
    path: PathBuf,
    /// Lower-cased abbreviations of the bundled translations.
    bundled_abbreviations: HashSet<String>,
}

impl std::fmt::Debug for UserBibleStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("UserBibleStore")
            .field("path", &self.path)
            .finish_non_exhaustive()
    }
}

/// Text that declares the work public domain (or has no copyright notice).
fn looks_public_domain(copyright: &str) -> bool {
    let lower = copyright.to_lowercase();
    lower.trim().is_empty()
        || lower.contains("public domain")
        || lower.contains("publicdomain")
        || lower.trim() == "pd"
}

impl UserBibleStore {
    /// Open (creating if needed) the user Bible database at `path`.
    ///
    /// `bundled_abbreviations` are the translations Manna ships; importing one
    /// of those reports [`BibleImportStatus::AlreadyInManna`].
    pub fn open(
        path: &Path,
        bundled_abbreviations: impl IntoIterator<Item = String>,
    ) -> Result<Self, BibleError> {
        if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.busy_timeout(BUSY_TIMEOUT)?;
        Self::ensure_schema(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
            path: path.to_owned(),
            bundled_abbreviations: bundled_abbreviations
                .into_iter()
                .map(|a| a.to_lowercase())
                .collect(),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn ensure_schema(conn: &Connection) -> Result<(), BibleError> {
        conn.execute_batch(&format!(
            "BEGIN IMMEDIATE;
             {SCHEMA}
             INSERT INTO sqlite_sequence (name, seq)
                 SELECT 'translations', {t} WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'translations');
             INSERT INTO sqlite_sequence (name, seq)
                 SELECT 'books', {b} WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'books');
             INSERT INTO sqlite_sequence (name, seq)
                 SELECT 'verses', {v} WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'verses');
             COMMIT;",
            t = USER_TRANSLATION_ID_START - 1,
            b = USER_BOOK_ID_START - 1,
            v = USER_VERSE_ID_START - 1,
        ))?;
        Ok(())
    }

    /// Write a parsed Bible in one transaction.
    ///
    /// Abbreviations are compared case-insensitively. A bundled abbreviation is
    /// never imported; an earlier import is kept unless `overwrite`, in which
    /// case it is replaced and keeps its translation id.
    ///
    /// # Panics
    ///
    /// Panics if the store's mutex is poisoned.
    pub fn import_bible(
        &self,
        bible: &ParsedBible,
        overwrite: bool,
    ) -> Result<BibleImportReport, BibleError> {
        let abbreviation = bible.abbreviation.trim();
        if abbreviation.is_empty() {
            return Err(BibleError::Parse("the Bible has no abbreviation".to_owned()));
        }
        let mut report = BibleImportReport {
            translation_id: None,
            title: bible.title.clone(),
            abbreviation: abbreviation.to_owned(),
            language: bible.language.clone(),
            status: BibleImportStatus::Imported,
            books: bible.books.len(),
            verses: bible.verse_count(),
            skipped_books: bible.skipped_books.clone(),
        };
        if self.bundled_abbreviations.contains(&abbreviation.to_lowercase()) {
            report.status = BibleImportStatus::AlreadyInManna;
            return Ok(report);
        }
        if report.verses == 0 {
            return Err(BibleError::Parse("the Bible has no verses".to_owned()));
        }

        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let existing: Option<i64> = tx
            .query_row(
                "SELECT id FROM translations WHERE abbreviation = ?1",
                [abbreviation],
                |row| row.get(0),
            )
            .optional()?;
        let copyright = bible.copyright.as_deref().map(str::trim).filter(|c| !c.is_empty());
        let license = copyright.unwrap_or(UNKNOWN_LICENSE);
        let is_copyrighted = copyright.is_some_and(|c| !looks_public_domain(c));

        let translation_id = match existing {
            Some(id) if !overwrite => {
                report.translation_id = Some(id);
                report.status = BibleImportStatus::SkippedExisting;
                return Ok(report);
            }
            Some(id) => {
                Self::delete_contents(&tx, id)?;
                tx.execute(
                    "UPDATE translations SET abbreviation = ?2, title = ?3, language = ?4, license = ?5,
                            is_copyrighted = ?6, is_downloaded = 1
                     WHERE id = ?1",
                    params![id, abbreviation, bible.title, bible.language, license, is_copyrighted],
                )?;
                report.status = BibleImportStatus::Updated;
                id
            }
            None => {
                tx.execute(
                    "INSERT INTO translations (abbreviation, title, language, license, is_copyrighted, is_downloaded)
                     VALUES (?1, ?2, ?3, ?4, ?5, 1)",
                    params![abbreviation, bible.title, bible.language, license, is_copyrighted],
                )?;
                tx.last_insert_rowid()
            }
        };

        Self::write_contents(&tx, translation_id, bible)?;
        tx.commit()?;
        report.translation_id = Some(translation_id);
        log::info!(
            "[BIBLE] {:?} {} ({} books, {} verses) as translation {translation_id}",
            report.status,
            report.abbreviation,
            report.books,
            report.verses
        );
        Ok(report)
    }

    /// Remove an imported Bible. Returns `false` when no such import exists.
    ///
    /// # Panics
    ///
    /// Panics if the store's mutex is poisoned.
    pub fn delete_translation(&self, translation_id: i64) -> Result<bool, BibleError> {
        if !is_user_translation(translation_id) {
            return Ok(false);
        }
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        Self::delete_contents(&tx, translation_id)?;
        let removed = tx.execute("DELETE FROM translations WHERE id = ?1", [translation_id])?;
        tx.commit()?;
        Ok(removed > 0)
    }

    /// Insert books, verses and the search index for one translation.
    fn write_contents(
        conn: &Connection,
        translation_id: i64,
        bible: &ParsedBible,
    ) -> Result<(), BibleError> {
        let mut insert_book = conn.prepare(
            "INSERT INTO books (translation_id, book_number, name, abbreviation, testament)
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )?;
        let mut insert_verse = conn.prepare(
            "INSERT INTO verses (translation_id, book_id, book_number, book_name, book_abbreviation, chapter, verse, text)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )?;
        for book in &bible.books {
            let book_id = insert_book.insert(params![
                translation_id,
                book.number,
                book.name,
                book.abbreviation,
                book.testament
            ])?;
            for verse in &book.verses {
                insert_verse.execute(params![
                    translation_id,
                    book_id,
                    book.number,
                    book.name,
                    book.abbreviation,
                    verse.chapter,
                    verse.verse,
                    verse.text
                ])?;
            }
        }
        conn.execute(
            "INSERT INTO verses_fts (rowid, text) SELECT id, text FROM verses WHERE translation_id = ?1",
            [translation_id],
        )?;
        Ok(())
    }

    fn delete_contents(conn: &Connection, translation_id: i64) -> Result<(), BibleError> {
        conn.execute(
            "DELETE FROM verses_fts WHERE rowid IN (SELECT id FROM verses WHERE translation_id = ?1)",
            [translation_id],
        )?;
        conn.execute("DELETE FROM verses WHERE translation_id = ?1", [translation_id])?;
        conn.execute("DELETE FROM books WHERE translation_id = ?1", [translation_id])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copyright_heuristic() {
        assert!(looks_public_domain("Public Domain"));
        assert!(looks_public_domain("This text is in the public domain."));
        assert!(!looks_public_domain("Copyright © 2011 Crossway"));
    }

    #[test]
    fn id_ranges_start_above_bundled_ids() {
        assert!(!is_user_translation(18));
        assert!(is_user_translation(USER_TRANSLATION_ID_START));
        assert!(is_user_verse(USER_VERSE_ID_START));
        assert!(!is_user_verse(600_000));
    }
}
