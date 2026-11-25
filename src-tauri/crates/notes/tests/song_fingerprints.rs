use rhema_notes::{SessionDb, SongFingerprint};

fn db_with_song(dir: &tempfile::TempDir) -> SessionDb {
    let db = SessionDb::open(&dir.path().join("manna.db")).unwrap();
    db.save_song("oceans", "user", None, "Oceans", None, "{}", 0).unwrap();
    db
}

fn fp(id: &str, source: &str, model: &str) -> SongFingerprint {
    SongFingerprint {
        id: id.into(),
        song_id: "oceans".into(),
        source: source.into(),
        model: model.into(),
        embeddings: vec![vec![0.5; 4], vec![-0.25; 4]],
    }
}

#[test]
fn stores_lists_and_deletes_fingerprints_by_model() {
    let dir = tempfile::tempdir().unwrap();
    let db = db_with_song(&dir);
    db.save_song_fingerprint(&fp("a", "operator", "clews-v1")).unwrap();
    db.save_song_fingerprint(&fp("b", "live", "clews-v1")).unwrap();
    db.save_song_fingerprint(&fp("old", "library", "other-model")).unwrap();

    let listed = db.list_song_fingerprints("clews-v1").unwrap();
    assert_eq!(listed.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(), ["a", "b"]);
    assert_eq!(listed[0], fp("a", "operator", "clews-v1"));

    let info = db.song_fingerprint_info(Some("oceans")).unwrap();
    assert_eq!(info.len(), 3);
    assert!(info.iter().all(|i| i.windows == 2));

    assert_eq!(db.delete_song_fingerprints(&["b".into(), "missing".into()]).unwrap(), 1);
    assert_eq!(db.list_song_fingerprints("clews-v1").unwrap().len(), 1);
}

#[test]
fn rejects_unknown_sources_and_empty_fingerprints() {
    let dir = tempfile::tempdir().unwrap();
    let db = db_with_song(&dir);
    assert!(db.save_song_fingerprint(&fp("x", "guess", "m")).is_err());
    let mut empty = fp("y", "live", "m");
    empty.embeddings.clear();
    assert!(db.save_song_fingerprint(&empty).is_err());
}

#[test]
fn deleting_a_song_deletes_its_fingerprints() {
    let dir = tempfile::tempdir().unwrap();
    let db = db_with_song(&dir);
    db.save_song_fingerprint(&fp("a", "live", "m")).unwrap();
    db.delete_song("oceans").unwrap();
    assert!(db.song_fingerprint_info(None).unwrap().is_empty());
}

#[test]
fn a_fingerprint_needs_an_existing_song() {
    let dir = tempfile::tempdir().unwrap();
    let db = db_with_song(&dir);
    let mut orphan = fp("a", "live", "m");
    orphan.song_id = "missing".into();
    assert!(db.save_song_fingerprint(&orphan).is_err());
}

#[test]
fn songs_stamp_changes_with_the_songs() {
    let dir = tempfile::tempdir().unwrap();
    let db = rhema_notes::SessionDb::open(&dir.path().join("t.db")).unwrap();
    let empty = db.songs_stamp().unwrap();
    assert_eq!(empty, db.songs_stamp().unwrap(), "stable while nothing changes");
    db.save_song("a", "custom", None, "A", None, "{}", 0).unwrap();
    let one = db.songs_stamp().unwrap();
    assert_ne!(one, empty);
    db.save_song("a", "custom", None, "A", None, r#"{"stanzas":[]}"#, 0).unwrap();
    assert_ne!(db.songs_stamp().unwrap(), one, "an edit changes it");
}
