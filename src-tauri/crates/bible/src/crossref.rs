use crate::db::BibleDb;
use crate::error::BibleError;
use crate::models::CrossReference;

impl BibleDb {
    /// # Panics
    ///
    /// Panics if the internal mutex is poisoned (i.e., a thread panicked
    /// while holding the database lock).
    pub fn get_cross_references(
        &self,
        book_number: i32,
        chapter: i32,
        verse: i32,
    ) -> Result<Vec<CrossReference>, BibleError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT from_book, from_chapter, from_verse, \
                    to_book, to_chapter, to_verse_start, to_verse_end, votes \
             FROM cross_references \
             WHERE from_book = ?1 AND from_chapter = ?2 AND from_verse = ?3 \
             ORDER BY votes DESC",
        )?;
        let rows = stmt.query_map(
            rusqlite::params![book_number, chapter, verse],
            |row: &rusqlite::Row| {
                let from_book: i32 = row.get(0)?;
                let from_chapter: i32 = row.get(1)?;
                let from_verse: i32 = row.get(2)?;
                let to_book: i32 = row.get(3)?;
                let to_chapter: i32 = row.get(4)?;
                let to_verse_start: i32 = row.get(5)?;
                let _to_verse_end: i32 = row.get(6)?;
                let votes: i32 = row.get(7)?;

                Ok(CrossReference {
                    from_ref: format!("{from_book}.{from_chapter}.{from_verse}"),
                    to_ref: format!("{to_book}.{to_chapter}.{to_verse_start}"),
                    votes,
                })
            },
        )?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }
}
