//! OpenLP Bible databases (`Data/bibles/*.sqlite`).
//!
//! Tables: `metadata(key, value)`, `book(id, book_reference_id,
//! testament_reference_id, name)`, `verse(id, book_id, chapter, verse, text)`.
//! `book_reference_id` 1–66 is the Protestant canon order; higher ids are
//! deuterocanonical books and are skipped.

use std::collections::{BTreeMap, HashMap};
use std::path::Path;

use rusqlite::{Connection, OpenFlags};

use super::{books, BibleFormat, Draft, ParsedBible};
use crate::error::BibleError;

/// ISO codes for OpenLP's `language_id` values (`openlp.core.common.languages`), by id − 1.
const LANGUAGES: [&str; 153] = [
    "om", "ab", "aa", "af", "sq", "am", "ar", "hy", "as", "ay", "az", "ba", "eu", "bn", "dz",
    "bh", "bi", "br", "bg", "my", "be", "km", "ca", "zh", "co", "hr", "cs", "da", "nl", "en",
    "eo", "et", "fo", "fj", "fi", "fr", "fy", "gl", "ka", "de", "el", "kl", "gn", "gu", "ha",
    "he", "hi", "hu", "is", "id", "ia", "ie", "ik", "iu", "ga", "it", "ja", "jw", "kn", "ks",
    "kk", "rw", "ky", "rn", "ko", "ku", "lo", "la", "lv", "ln", "lt", "mk", "mg", "ms", "ml",
    "mt", "mi", "mr", "mo", "mn", "na", "ne", "no", "oc", "or", "ps", "fa", "pl", "pt", "pa",
    "qu", "rm", "ro", "ru", "sm", "sg", "sa", "gd", "sr", "sh", "st", "tn", "sn", "sd", "si",
    "ss", "sk", "sl", "so", "es", "su", "sw", "sv", "tl", "tg", "ta", "tt", "te", "th", "bo",
    "ti", "to", "ts", "tr", "tk", "tw", "ug", "uk", "ur", "uz", "vi", "vo", "cy", "wo", "xh",
    "yi", "yo", "za", "zu", "amu", "cco", "cak", "ht", "hil", "jac", "kek", "mri", "mam", "nah",
    "quc", "pdt", "grc", "usp",
];

fn language_code(language_id: &str) -> Option<&'static str> {
    let id: usize = language_id.trim().parse().ok()?;
    LANGUAGES.get(id.checked_sub(1)?).copied()
}

/// Strip OpenLP display markup: `{it}was{/it}` and `{r}…{/r}` formatting
/// tags and KJV italics brackets (`[was]`) lose the markup but keep their
/// words. Angle-bracketed psalm superscriptions (`<A Prayer of David.>`) and
/// stray HTML tags are dropped: headings are not verse text, as in the bundled
/// translations and the OSIS/Zefania importers.
pub(super) fn clean_verse_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(ch) = rest.chars().next() {
        let after = &rest[ch.len_utf8()..];
        let closed_by = |close: char| after.find(close).map(|end| (&after[..end], &after[end + 1..]));
        let skip_to = match ch {
            '{' => closed_by('}')
                .filter(|(tag, _)| is_tag_name(tag.trim_start_matches('/')))
                .map(|(_, remaining)| remaining),
            '<' => closed_by('>').map(|(_, remaining)| remaining),
            _ => None,
        };
        if let Some(remaining) = skip_to {
            // Formatting tags sit inside words and before punctuation; headings do not.
            if ch == '<' {
                out.push(' ');
            }
            rest = remaining;
            continue;
        }
        if !matches!(ch, '[' | ']' | '<' | '>') {
            out.push(ch);
        }
        rest = after;
    }
    out
}

fn is_tag_name(tag: &str) -> bool {
    !tag.is_empty() && tag.len() <= 12 && tag.chars().all(|c| c.is_ascii_alphanumeric())
}

/// OpenLP book id → canonical book number, one source book per number.
///
/// Some OpenLP Bibles give an apocryphal book a canonical reference id (the
/// bundled-with-apocrypha KJV files label 1 Esdras as Ezra). When two books
/// claim a number, the one whose name matches the canon wins, else the first.
fn canonical_books(conn: &Connection, draft: &mut Draft) -> Result<HashMap<i64, i32>, BibleError> {
    let mut stmt = conn.prepare("SELECT id, book_reference_id, name FROM book ORDER BY id")?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Option<i32>>(1)?,
                row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut chosen: BTreeMap<i32, (i64, &str)> = BTreeMap::new();
    for (id, reference, name) in &rows {
        let Some(number) = reference.filter(|n| (1..=books::BOOK_COUNT).contains(n)) else {
            continue;
        };
        let replaces = chosen.get(&number).is_some_and(|(_, current)| {
            books::number_from_name(current) != Some(number)
                && books::number_from_name(name) == Some(number)
        });
        if replaces || !chosen.contains_key(&number) {
            chosen.insert(number, (*id, name));
        }
    }
    let mut canonical = HashMap::new();
    for (number, (id, name)) in &chosen {
        canonical.insert(*id, *number);
        draft.name_book(*number, Some(name));
    }
    for (id, _, name) in &rows {
        if !canonical.contains_key(id) {
            draft.skip_book(if name.is_empty() { "Unnamed book" } else { name });
        }
    }
    Ok(canonical)
}

/// Parse an OpenLP Bible database, opened read-only.
pub fn parse_openlp(path: &Path) -> Result<ParsedBible, BibleError> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    let has_tables: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('metadata', 'book', 'verse')",
        [],
        |row| row.get(0),
    )?;
    if has_tables != 3 {
        return Err(BibleError::Parse(
            "this SQLite file is not an OpenLP Bible database".to_owned(),
        ));
    }

    let metadata: HashMap<String, String> = conn
        .prepare("SELECT key, value FROM metadata WHERE value IS NOT NULL")?
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
        .collect::<Result<_, _>>()?;
    let mut draft = Draft::default();
    Draft::set_if_empty(&mut draft.title, metadata.get("name").map(String::as_str));
    Draft::set_if_empty(&mut draft.copyright, metadata.get("copyright").map(String::as_str));
    let language = metadata.get("language_id").and_then(|id| language_code(id));
    Draft::set_if_empty(&mut draft.language, language);

    let canonical = canonical_books(&conn, &mut draft)?;

    let mut stmt = conn.prepare(
        "SELECT book_id, chapter, verse, text FROM verse ORDER BY book_id, chapter, verse, id",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, Option<i64>>(0)?,
            row.get::<_, Option<i32>>(1)?,
            row.get::<_, Option<i32>>(2)?,
            row.get::<_, Option<String>>(3)?,
        ))
    })?;
    for row in rows {
        let (Some(book_id), Some(chapter), Some(verse), Some(text)) = row? else {
            continue;
        };
        if let Some(&number) = canonical.get(&book_id) {
            draft.push_verse(number, chapter, verse, &clean_verse_text(&text));
        }
    }

    let file_stem = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default();
    draft.finish(BibleFormat::OpenLp, &file_stem)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(dir: &Path) -> std::path::PathBuf {
        let path = dir.join("Test_Bible.sqlite");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE metadata (key VARCHAR(255) NOT NULL PRIMARY KEY, value VARCHAR(255));
             CREATE TABLE book (id INTEGER PRIMARY KEY, book_reference_id INTEGER,
                                testament_reference_id INTEGER, name VARCHAR(50));
             CREATE TABLE verse (id INTEGER PRIMARY KEY, book_id INTEGER, chapter INTEGER,
                                 verse INTEGER, text TEXT);
             INSERT INTO metadata VALUES ('name', 'Test Bible'), ('copyright', 'Public Domain'),
                                         ('language_id', '30'), ('permissions', NULL);
             INSERT INTO book VALUES (1, 1, 1, 'Genesis'), (2, 43, 2, 'John'), (3, 67, 3, 'Judith'),
                                     (4, 43, 3, 'Esdras'), (5, 15, 3, 'Esdras'), (6, 15, 1, 'Ezra');
             INSERT INTO verse VALUES
               (1, 1, 1, 2, 'And the earth was without form, and void; and darkness [was] upon the face of the deep.'),
               (2, 1, 1, 1, '  In the beginning God created the heaven and the earth. '),
               (3, 2, 3, 16, '{r}For God so loved the world{/r}'),
               (4, 3, 1, 1, 'Judith text'),
               (5, 1, 1, 3, NULL),
               (6, 4, 3, 16, 'Esdras text'), (7, 5, 1, 1, 'Esdras text'), (8, 6, 1, 1, 'Ezra text');",
        )
        .unwrap();
        path
    }

    #[test]
    fn reads_metadata_books_and_cleans_markup() {
        let dir = tempfile::tempdir().unwrap();
        let bible = parse_openlp(&fixture(dir.path())).unwrap();
        assert_eq!(bible.format, BibleFormat::OpenLp);
        assert_eq!(bible.title, "Test Bible");
        assert_eq!(bible.abbreviation, "TestBible");
        assert_eq!(bible.language, "en");
        assert_eq!(bible.copyright.as_deref(), Some("Public Domain"));
        // Apocryphal books mislabeled with a canonical id never replace the real book.
        assert_eq!(bible.skipped_books, vec!["Judith", "Esdras"]);
        assert_eq!(bible.verse_count(), 4);
        assert_eq!(bible.books[1].verses[0].text, "Ezra text");
        let genesis = &bible.books[0];
        assert_eq!(genesis.verses[0].text, "In the beginning God created the heaven and the earth.");
        assert_eq!(
            genesis.verses[1].text,
            "And the earth was without form, and void; and darkness was upon the face of the deep."
        );
        assert_eq!(bible.books[2].verses[0].text, "For God so loved the world");
    }

    #[test]
    fn rejects_sqlite_files_that_are_not_bibles() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("songs.sqlite");
        Connection::open(&path).unwrap().execute_batch("CREATE TABLE songs (id INTEGER);").unwrap();
        assert!(matches!(parse_openlp(&path), Err(BibleError::Parse(_))));
    }

    #[test]
    fn markup_is_removed_but_words_are_kept() {
        assert_eq!(
            super::super::clean_text(&clean_verse_text("<A Prayer of David.> Bow down, for I [am] poor")),
            "Bow down, for I am poor"
        );
        assert_eq!(clean_verse_text("darkness {it}was{/it} upon"), "darkness was upon");
        assert_eq!(clean_verse_text("{r}loved the world{/r}."), "loved the world.");
        assert_eq!(super::super::clean_text(&clean_verse_text("one<br/>two")), "one two");
        assert_eq!(clean_verse_text("a {not a tag} b"), "a {not a tag} b");
    }

    #[test]
    fn language_ids_follow_openlp_table() {
        assert_eq!(language_code("30"), Some("en"));
        assert_eq!(language_code("40"), Some("de"));
        assert_eq!(language_code("110"), Some("es"));
        assert_eq!(language_code("0"), None);
        assert_eq!(language_code("x"), None);
    }
}
