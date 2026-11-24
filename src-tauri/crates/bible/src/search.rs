use crate::db::{BibleDb, USER_SCHEMA};
use crate::error::BibleError;
use crate::models::{Book, Verse};
use crate::user_store::is_user_translation;

impl BibleDb {
    /// # Panics
    ///
    /// Panics if the internal mutex is poisoned (i.e., a thread panicked
    /// while holding the database lock).
    pub fn search_verses(
        &self,
        query: &str,
        translation_id: i64,
        limit: usize,
    ) -> Result<Vec<Verse>, BibleError> {
        // Each database has its own FTS index keyed by its verse ids; the
        // combined `verses` view has no rowid to join on.
        let schema = if self.user.is_some() && is_user_translation(translation_id) {
            USER_SCHEMA
        } else {
            "main"
        };
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&format!(
            "SELECT v.id, v.translation_id, v.book_number, v.book_name, v.book_abbreviation, v.chapter, v.verse, v.text \
             FROM {schema}.verses_fts fts \
             JOIN {schema}.verses v ON v.id = fts.rowid \
             WHERE fts.text MATCH ?1 AND v.translation_id = ?2 \
             LIMIT ?3",
        ))?;
        #[expect(
            clippy::cast_possible_wrap,
            reason = "limit is a small page-size value that fits in i64"
        )]
        let limit_i64 = limit as i64;
        let rows = stmt.query_map(
            rusqlite::params![query, translation_id, limit_i64],
            |row: &rusqlite::Row| {
                Ok(Verse {
                    id: row.get(0)?,
                    translation_id: row.get(1)?,
                    book_number: row.get(2)?,
                    book_name: row.get(3)?,
                    book_abbreviation: row.get(4)?,
                    chapter: row.get(5)?,
                    verse: row.get(6)?,
                    text: row.get(7)?,
                })
            },
        )?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn search_books(&self, query: &str) -> Result<Vec<Book>, BibleError> {
        let conn = self.conn.lock().unwrap();
        let pattern = format!("{query}%");
        let mut stmt = conn.prepare(
            "SELECT id, translation_id, book_number, name, abbreviation, testament \
             FROM books \
             WHERE name LIKE ?1 OR abbreviation LIKE ?1 \
             ORDER BY book_number",
        )?;
        let rows = stmt.query_map(rusqlite::params![pattern], |row: &rusqlite::Row| {
            Ok(Book {
                id: row.get(0)?,
                translation_id: row.get(1)?,
                book_number: row.get(2)?,
                name: row.get(3)?,
                abbreviation: row.get(4)?,
                testament: row.get(5)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }
}
