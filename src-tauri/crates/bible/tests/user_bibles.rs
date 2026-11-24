//! Imported Bibles live in a writable user database and are read together
//! with the read-only bundled database.

use std::path::{Path, PathBuf};

use rhema_bible::{
    import::parse_osis, is_user_translation, is_user_verse, BibleDb, BibleError,
    BibleImportStatus, ParsedBible, UserBibleStore,
};
use rusqlite::Connection;

const SCHEMA: &str = include_str!("../../../../data/schema.sql");

/// A bundled database shaped like `data/build-bible-db.ts` output.
fn bundled(dir: &Path) -> PathBuf {
    let path = dir.join("rhema.db");
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch(SCHEMA).unwrap();
    conn.execute_batch(
        "INSERT INTO translations (abbreviation, title, language, license)
             VALUES ('KJV', 'King James Version', 'en', 'Public Domain');
         INSERT INTO books (translation_id, book_number, name, abbreviation, testament)
             VALUES (1, 1, 'Genesis', 'Gen', 'OT'), (1, 43, 'John', 'John', 'NT');
         INSERT INTO verses (translation_id, book_id, book_number, book_name, book_abbreviation, chapter, verse, text)
             VALUES (1, 1, 1, 'Genesis', 'Gen', 1, 1, 'In the beginning God created the heaven and the earth.'),
                    (1, 2, 43, 'John', 'John', 3, 16, 'For God so loved the world, that he gave his only begotten Son');
         CREATE VIRTUAL TABLE verses_fts USING fts5(text, content='verses', content_rowid='id', tokenize='unicode61');
         INSERT INTO verses_fts(rowid, text) SELECT id, text FROM verses;",
    )
    .unwrap();
    path
}

fn web(john_3_16: &str) -> ParsedBible {
    let xml = format!(
        r#"<osis><osisText osisIDWork="WEB" xml:lang="en">
          <header><work osisWork="WEB"><title>World English Bible</title><rights>Public Domain</rights></work></header>
          <div type="book" osisID="Gen"><verse osisID="Gen.1.1">In the beginning, God created the heavens and the earth.</verse>
            <verse osisID="Gen.1.2">The earth was formless and empty.</verse></div>
          <div type="book" osisID="John"><verse osisID="John.3.16">{john_3_16}</verse></div>
        </osisText></osis>"#
    );
    parse_osis(&xml, "web").unwrap()
}

#[test]
fn imported_bible_is_visible_through_every_lookup() {
    let dir = tempfile::tempdir().unwrap();
    let user = dir.path().join("nested").join("user-bibles.db");
    let db = BibleDb::open_with_user(&bundled(dir.path()), &user).unwrap();
    assert!(user.exists());
    assert_eq!(db.list_translations().unwrap().len(), 1);

    let report = db.import_bible(&web("For God so loved the world, that he gave his one and only Son"), false).unwrap();
    assert_eq!(report.status, BibleImportStatus::Imported);
    assert_eq!((report.books, report.verses), (2, 3));
    let id = report.translation_id.unwrap();
    assert!(is_user_translation(id));
    assert_eq!(id, 1_000_000);

    let translations = db.list_translations().unwrap();
    let imported = translations.iter().find(|t| t.id == id).unwrap();
    assert_eq!(imported.abbreviation, "WEB");
    assert_eq!(imported.title, "World English Bible");
    assert!(!imported.is_copyrighted && imported.is_downloaded);

    let books = db.list_books(id).unwrap();
    assert_eq!(books.len(), 2);
    assert!(books.iter().all(|b| b.id >= 100_000_000));
    assert_eq!(books[1].testament, "NT");

    let verse = db.get_verse(id, 43, 3, 16).unwrap().unwrap();
    assert!(is_user_verse(verse.id));
    assert!(verse.text.contains("one and only Son"));
    assert_eq!(db.get_verse_by_id(verse.id).unwrap().unwrap(), verse);
    assert_eq!(db.get_chapter(id, 1, 1).unwrap().len(), 2);
    assert_eq!(db.get_verse_range(id, 1, 1, 1, 2).unwrap().len(), 2);
    assert_eq!(db.load_translation_verses_for_search(id).unwrap().len(), 3);
    assert_eq!(db.load_verse_locations("en").unwrap().len(), 5);
    assert_eq!(db.load_all_verses_for_quotation(Some("en")).unwrap().len(), 5);

    let hits = db.search_verses("formless", id, 10).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!((hits[0].book_number, hits[0].verse), (1, 2));
    // Bundled search still uses the bundled index and stays per-translation.
    assert_eq!(db.search_verses("begotten", 1, 10).unwrap().len(), 1);
    assert!(db.search_verses("formless", 1, 10).unwrap().is_empty());
    assert!(db.search_verses("begotten", id, 10).unwrap().is_empty());
    // Book search covers both databases.
    assert_eq!(db.search_books("John").unwrap().len(), 2);
}

#[test]
fn imports_from_another_connection_appear_without_reopening() {
    let dir = tempfile::tempdir().unwrap();
    let user = dir.path().join("user-bibles.db");
    let db = BibleDb::open_with_user(&bundled(dir.path()), &user).unwrap();
    assert_eq!(db.list_translations().unwrap().len(), 1);

    let other = UserBibleStore::open(&user, ["KJV".to_owned()]).unwrap();
    other.import_bible(&web("For God so loved the world"), false).unwrap();
    assert_eq!(db.list_translations().unwrap().len(), 2);
    assert_eq!(db.search_verses("formless", 1_000_000, 5).unwrap().len(), 1);
}

#[test]
fn abbreviation_conflicts_and_overwrite() {
    let dir = tempfile::tempdir().unwrap();
    let user = dir.path().join("user-bibles.db");
    let db = BibleDb::open_with_user(&bundled(dir.path()), &user).unwrap();

    let mut kjv = web("x");
    kjv.abbreviation = "kjv".to_owned();
    let report = db.import_bible(&kjv, true).unwrap();
    assert_eq!(report.status, BibleImportStatus::AlreadyInManna);
    assert_eq!(report.translation_id, None);
    assert_eq!(db.list_translations().unwrap().len(), 1);

    let first = db.import_bible(&web("old text"), false).unwrap();
    let id = first.translation_id.unwrap();
    let skipped = db.import_bible(&web("new text"), false).unwrap();
    assert_eq!(skipped.status, BibleImportStatus::SkippedExisting);
    assert_eq!(skipped.translation_id, Some(id));
    assert_eq!(db.get_verse(id, 43, 3, 16).unwrap().unwrap().text, "old text");

    let mut renamed = web("new text");
    renamed.abbreviation = "web".to_owned();
    renamed.copyright = Some("Copyright 2024 Example Press".to_owned());
    let updated = db.import_bible(&renamed, true).unwrap();
    assert_eq!(updated.status, BibleImportStatus::Updated);
    assert_eq!(updated.translation_id, Some(id));
    assert_eq!(db.list_translations().unwrap().len(), 2);
    assert_eq!(db.get_verse(id, 43, 3, 16).unwrap().unwrap().text, "new text");
    assert!(db.search_verses("old", id, 5).unwrap().is_empty());
    assert_eq!(db.search_verses("new", id, 5).unwrap().len(), 1);
    assert_eq!(db.list_books(id).unwrap().len(), 2);
    let translation = db.list_translations().unwrap().into_iter().find(|t| t.id == id).unwrap();
    assert!(translation.is_copyrighted);
}

#[test]
fn imports_persist_and_ids_are_never_reused() {
    let dir = tempfile::tempdir().unwrap();
    let bundled = bundled(dir.path());
    let user = dir.path().join("user-bibles.db");
    let first_id = {
        let db = BibleDb::open_with_user(&bundled, &user).unwrap();
        db.import_bible(&web("x"), false).unwrap().translation_id.unwrap()
    };
    let db = BibleDb::open_with_user(&bundled, &user).unwrap();
    assert!(db.list_translations().unwrap().iter().any(|t| t.id == first_id));

    assert!(db.delete_user_translation(first_id).unwrap());
    assert!(!db.delete_user_translation(1).unwrap(), "bundled translations are not removable");
    assert_eq!(db.list_translations().unwrap().len(), 1);
    assert!(db.search_verses("formless", first_id, 5).unwrap().is_empty());

    let again = db.import_bible(&web("x"), false).unwrap();
    assert!(again.translation_id.unwrap() > first_id);
}

#[test]
fn bundled_only_database_has_no_user_store() {
    let dir = tempfile::tempdir().unwrap();
    let db = BibleDb::open(&bundled(dir.path())).unwrap();
    assert!(db.user_store().is_none());
    assert!(matches!(db.import_bible(&web("x"), false), Err(BibleError::NoUserStore)));
    assert_eq!(db.search_verses("begotten", 1, 10).unwrap().len(), 1);
}

#[test]
fn bundled_database_is_untouched_by_the_combined_connection() {
    let dir = tempfile::tempdir().unwrap();
    let bundled = bundled(dir.path());
    let before = std::fs::read(&bundled).unwrap();
    let db = BibleDb::open_with_user(&bundled, &dir.path().join("user.db")).unwrap();
    db.import_bible(&web("x"), false).unwrap();
    drop(db);
    assert_eq!(std::fs::read(&bundled).unwrap(), before);
    assert!(!dir.path().join("rhema.db-journal").exists());
    assert!(!dir.path().join("rhema.db-wal").exists());
}
