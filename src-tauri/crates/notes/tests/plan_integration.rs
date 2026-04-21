// src-tauri/crates/notes/tests/plan_integration.rs
use rhema_notes::{PlanItemType, PlanKind, SessionDb};
use tempfile::NamedTempFile;

fn open_db() -> SessionDb {
    let file = NamedTempFile::new().unwrap();
    let path = file.path().to_path_buf();
    drop(file); // keep path; open will create
    SessionDb::open(&path).expect("open db")
}

#[test]
fn template_create_list_rename_delete() {
    let mut db = open_db();
    let t = db.create_template("Sunday AM", Some("morning service")).unwrap();
    assert_eq!(t.name, "Sunday AM");
    assert_eq!(t.item_count, 0);

    db.rename_template(t.id, "Sunday Morning").unwrap();
    let list = db.list_templates().unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].name, "Sunday Morning");

    db.delete_template(t.id).unwrap();
    assert!(db.list_templates().unwrap().is_empty());
}

#[test]
fn add_and_reorder_items() {
    let db = open_db();
    let t = db.create_template("T", None).unwrap();

    let a = db
        .add_plan_item(t.id, PlanKind::Template, PlanItemType::Section, r#"{"label":"A"}"#, 1.0, None)
        .unwrap();
    let b = db
        .add_plan_item(t.id, PlanKind::Template, PlanItemType::Section, r#"{"label":"B"}"#, 2.0, None)
        .unwrap();
    let c = db
        .add_plan_item(t.id, PlanKind::Template, PlanItemType::Section, r#"{"label":"C"}"#, 3.0, None)
        .unwrap();

    // Move C between A and B using fractional index.
    db.reorder_plan_item(c.id, 1.5).unwrap();

    let plan = db.get_plan(t.id, PlanKind::Template).unwrap();
    assert_eq!(plan.items.len(), 3);
    assert_eq!(plan.items[0].id, a.id);
    assert_eq!(plan.items[1].id, c.id);
    assert_eq!(plan.items[2].id, b.id);
}

#[test]
fn delete_template_cascades_items() {
    let mut db = open_db();
    let t = db.create_template("T", None).unwrap();
    db.add_plan_item(t.id, PlanKind::Template, PlanItemType::Blank, "{}", 1.0, None).unwrap();
    db.add_plan_item(t.id, PlanKind::Template, PlanItemType::Blank, "{}", 2.0, None).unwrap();
    db.delete_template(t.id).unwrap();
    let plan = db.get_plan(t.id, PlanKind::Template).unwrap();
    assert!(plan.items.is_empty());
}

#[test]
fn load_template_into_session_replaces_items() {
    let mut db = open_db();
    let t = db.create_template("T", None).unwrap();
    db.add_plan_item(t.id, PlanKind::Template, PlanItemType::Section, r#"{"label":"Worship"}"#, 1.0, None).unwrap();
    db.add_plan_item(t.id, PlanKind::Template, PlanItemType::Section, r#"{"label":"Sermon"}"#, 2.0, None).unwrap();

    // Simulate an existing session plan with junk in it.
    let session_id: i64 = 999;
    db.add_plan_item(session_id, PlanKind::Session, PlanItemType::Blank, "{}", 1.0, None).unwrap();

    db.load_template_into_session(session_id, t.id).unwrap();

    let plan = db.get_plan(session_id, PlanKind::Session).unwrap();
    assert_eq!(plan.items.len(), 2);
    assert!(matches!(plan.items[0].item_type, PlanItemType::Section));
}

#[test]
fn clone_session_plan_copies_items() {
    let mut db = open_db();
    let src: i64 = 1;
    let dst: i64 = 2;
    db.add_plan_item(src, PlanKind::Session, PlanItemType::Blank, "{}", 1.0, None).unwrap();
    db.add_plan_item(src, PlanKind::Session, PlanItemType::Blank, "{}", 2.0, None).unwrap();

    db.clone_session_plan(dst, src).unwrap();

    let copy = db.get_plan(dst, PlanKind::Session).unwrap();
    assert_eq!(copy.items.len(), 2);
}

#[test]
fn save_session_as_template_creates_template_with_items() {
    let mut db = open_db();
    let session_id: i64 = 1;
    db.add_plan_item(session_id, PlanKind::Session, PlanItemType::Blank, "{}", 1.0, None).unwrap();

    let tid = db.save_session_as_template(session_id, "Saved", None).unwrap();
    let plan = db.get_plan(tid, PlanKind::Template).unwrap();
    assert_eq!(plan.items.len(), 1);
}
