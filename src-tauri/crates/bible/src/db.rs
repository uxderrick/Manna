use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rusqlite::{Connection, OpenFlags};

use crate::error::BibleError;
use crate::import::ParsedBible;
use crate::user_store::{BibleImportReport, UserBibleStore};

/// Schema name of the attached user Bible database.
pub(crate) const USER_SCHEMA: &str = "user_bibles";

/// TEMP views shadow the bundled tables for unqualified names, so every
/// existing query reads bundled and imported rows together.
const COMBINED_VIEWS: &str = "
CREATE TEMP VIEW translations AS
    SELECT id, abbreviation, title, language, license, is_copyrighted, is_downloaded FROM main.translations
    UNION ALL
    SELECT id, abbreviation, title, language, license, is_copyrighted, is_downloaded FROM user_bibles.translations;
CREATE TEMP VIEW books AS
    SELECT id, translation_id, book_number, name, abbreviation, testament FROM main.books
    UNION ALL
    SELECT id, translation_id, book_number, name, abbreviation, testament FROM user_bibles.books;
CREATE TEMP VIEW verses AS
    SELECT id, translation_id, book_id, book_number, book_name, book_abbreviation, chapter, verse, text FROM main.verses
    UNION ALL
    SELECT id, translation_id, book_id, book_number, book_name, book_abbreviation, chapter, verse, text FROM user_bibles.verses;
";

pub struct BibleDb {
    pub(crate) conn: Mutex<Connection>,
    pub(crate) user: Option<Arc<UserBibleStore>>,
}

impl std::fmt::Debug for BibleDb {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("BibleDb")
            .field("user", &self.user)
            .finish_non_exhaustive()
    }
}

impl BibleDb {
    pub fn open(path: &Path) -> Result<Self, BibleError> {
        // Shipped Bible resources must remain unchanged inside a signed app bundle.
        let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        Ok(Self {
            conn: Mutex::new(conn),
            user: None,
        })
    }

    /// Open the bundled database read-only together with the writable user
    /// database of imported Bibles (created if missing, e.g.
    /// `<app data dir>/user-bibles.db`).
    ///
    /// All lookups and searches see bundled and imported translations alike;
    /// imports through [`Self::import_bible`] or [`Self::user_store`] are
    /// visible immediately, without reopening.
    pub fn open_with_user(bundled: &Path, user: &Path) -> Result<Self, BibleError> {
        let conn = Connection::open_with_flags(bundled, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let bundled_abbreviations = conn
            .prepare("SELECT abbreviation FROM main.translations")?
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        // Creates the file and schema through its own writable connection.
        let store = UserBibleStore::open(user, bundled_abbreviations)?;

        // Attached databases inherit the read-only flag; writes go through `store`.
        conn.busy_timeout(Duration::from_secs(10))?;
        conn.execute(
            &format!("ATTACH DATABASE ?1 AS {USER_SCHEMA}"),
            [user.to_string_lossy()],
        )?;
        // TEMP objects are writable on a read-only connection; keep them in memory.
        conn.execute_batch(&format!("PRAGMA temp_store = MEMORY; {COMBINED_VIEWS}"))?;
        Ok(Self {
            conn: Mutex::new(conn),
            user: Some(Arc::new(store)),
        })
    }

    /// The writable store of imported Bibles, when opened with
    /// [`Self::open_with_user`]. It can be cloned out and used without
    /// holding whatever lock guards this `BibleDb`.
    pub fn user_store(&self) -> Option<Arc<UserBibleStore>> {
        self.user.clone()
    }

    /// Import a parsed Bible into the user database; see
    /// [`UserBibleStore::import_bible`].
    pub fn import_bible(
        &self,
        bible: &ParsedBible,
        overwrite: bool,
    ) -> Result<BibleImportReport, BibleError> {
        self.user
            .as_ref()
            .ok_or(BibleError::NoUserStore)?
            .import_bible(bible, overwrite)
    }

    /// Remove an imported Bible; bundled translations cannot be removed.
    pub fn delete_user_translation(&self, translation_id: i64) -> Result<bool, BibleError> {
        self.user
            .as_ref()
            .ok_or(BibleError::NoUserStore)?
            .delete_translation(translation_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opening_a_bundled_database_does_not_allow_writes_or_create_journals() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("bible.db");
        let source = Connection::open(&path).unwrap();
        source
            .execute_batch("CREATE TABLE example (id INTEGER); INSERT INTO example VALUES (1);")
            .unwrap();
        drop(source);

        let database = BibleDb::open(&path).unwrap();
        let connection = database.conn.lock().unwrap();
        assert_eq!(
            connection
                .query_row("SELECT id FROM example", [], |row| row.get::<_, i32>(0))
                .unwrap(),
            1
        );
        assert!(connection
            .execute("INSERT INTO example VALUES (2)", [])
            .is_err());
        assert!(!directory.path().join("bible.db-wal").exists());
        assert!(!directory.path().join("bible.db-shm").exists());
    }

    #[test]
    fn combined_connection_reads_through_temp_views_but_cannot_write() {
        let directory = tempfile::tempdir().unwrap();
        let bundled = directory.path().join("bible.db");
        Connection::open(&bundled)
            .unwrap()
            .execute_batch(
                "CREATE TABLE translations (id INTEGER PRIMARY KEY, abbreviation TEXT, title TEXT,
                     language TEXT, license TEXT, is_copyrighted INTEGER, is_downloaded INTEGER);
                 CREATE TABLE books (id INTEGER PRIMARY KEY, translation_id INTEGER, book_number INTEGER,
                     name TEXT, abbreviation TEXT, testament TEXT);
                 CREATE TABLE verses (id INTEGER PRIMARY KEY, translation_id INTEGER, book_id INTEGER,
                     book_number INTEGER, book_name TEXT, book_abbreviation TEXT, chapter INTEGER,
                     verse INTEGER, text TEXT);
                 INSERT INTO translations VALUES (1, 'KJV', 'King James Version', 'en', 'PD', 0, 1);",
            )
            .unwrap();

        let database = BibleDb::open_with_user(&bundled, &directory.path().join("user.db")).unwrap();
        let connection = database.conn.lock().unwrap();
        let views: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_temp_master WHERE type = 'view'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(views, 3);
        assert!(connection
            .execute("INSERT INTO main.translations (id) VALUES (2)", [])
            .is_err());
        assert!(connection
            .execute("INSERT INTO user_bibles.translations (id) VALUES (2)", [])
            .is_err());
        drop(connection);
        assert_eq!(database.list_translations().unwrap().len(), 1);
    }

    #[test]
    fn missing_bundled_database_is_not_silently_created() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("missing.db");
        assert!(BibleDb::open(&path).is_err());
        assert!(!path.exists());
    }
}
