//! Manual check against a local `OpenLP` install:
//! `cargo test -p rhema-bible --test openlp_real_files -- --ignored --nocapture`

use std::path::PathBuf;

use rhema_bible::{parse_bible_file, BibleDb};

fn openlp_bibles() -> Vec<PathBuf> {
    let Some(home) = std::env::var_os("HOME") else {
        return Vec::new();
    };
    let dir = PathBuf::from(home).join("Library/Application Support/openlp/Data/bibles");
    ["KJV", "ASV", "World_English_Bible", "KJVRLE"]
        .iter()
        .map(|name| dir.join(format!("{name}.sqlite")))
        .filter(|path| path.exists())
        .collect()
}

#[test]
#[ignore = "needs a local OpenLP install"]
fn real_openlp_bibles_parse_and_import() {
    let dir = tempfile::tempdir().unwrap();
    let bundled = dir.path().join("rhema.db");
    rusqlite::Connection::open(&bundled)
        .unwrap()
        .execute_batch(include_str!("../../../../data/schema.sql"))
        .unwrap();
    rusqlite::Connection::open(&bundled)
        .unwrap()
        .execute_batch(
            "INSERT INTO translations (abbreviation, title, language, license)
                 VALUES ('KJV', 'King James Version', 'en', 'PD'), ('ASV', 'American Standard Version', 'en', 'PD');
             CREATE VIRTUAL TABLE verses_fts USING fts5(text, content='verses', content_rowid='id');",
        )
        .unwrap();
    let db = BibleDb::open_with_user(&bundled, &dir.path().join("user.db")).unwrap();

    for path in openlp_bibles() {
        let started = std::time::Instant::now();
        let bible = parse_bible_file(&path).unwrap();
        let parsed_in = started.elapsed();
        let report = db.import_bible(&bible, false).unwrap();
        println!(
            "{}: {} / {} [{}] books={} verses={} skipped={:?} status={:?} id={:?} parse={parsed_in:?} total={:?}",
            path.file_name().unwrap().to_string_lossy(),
            bible.abbreviation,
            bible.title,
            bible.language,
            bible.books.len(),
            bible.verse_count(),
            bible.skipped_books,
            report.status,
            report.translation_id,
            started.elapsed(),
        );
        assert_eq!(bible.books.len(), 66);
        assert!(bible.verse_count() > 31_000);
        if let Some(id) = report.translation_id {
            let verse = db.get_verse(id, 43, 3, 16).unwrap().unwrap();
            println!("    John 3:16 = {}", verse.text);
            let psalm = db.get_verse(id, 19, 86, 1).unwrap().unwrap();
            println!("    Psalm 86:1 = {}", psalm.text);
            println!("    Gen 1:2 = {}", db.get_verse(id, 1, 1, 2).unwrap().unwrap().text);
            assert!(!db.search_verses("shepherd", id, 5).unwrap().is_empty());
        }
    }
}
