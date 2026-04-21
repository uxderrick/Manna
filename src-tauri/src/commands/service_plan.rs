use std::sync::Mutex;

use tauri::State;

use rhema_notes::{Plan, PlanItem, PlanItemType, PlanKind, SessionDb, TemplateMeta};

type DbState = Mutex<SessionDb>;

fn lock(db: &DbState) -> Result<std::sync::MutexGuard<'_, SessionDb>, String> {
    db.lock().map_err(|e| e.to_string())
}

/* ----------------------- Templates ----------------------- */

#[tauri::command]
pub fn plan_list_templates(db: State<'_, DbState>) -> Result<Vec<TemplateMeta>, String> {
    lock(&db)?.list_templates().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn plan_create_template(
    db: State<'_, DbState>,
    name: String,
    notes: Option<String>,
) -> Result<TemplateMeta, String> {
    lock(&db)?
        .create_template(&name, notes.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn plan_rename_template(
    db: State<'_, DbState>,
    id: i64,
    name: String,
) -> Result<(), String> {
    lock(&db)?.rename_template(id, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn plan_update_template_notes(
    db: State<'_, DbState>,
    id: i64,
    notes: Option<String>,
) -> Result<(), String> {
    lock(&db)?
        .update_template_notes(id, notes.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn plan_delete_template(db: State<'_, DbState>, id: i64) -> Result<(), String> {
    lock(&db)?.delete_template(id).map_err(|e| e.to_string())
}

/* ----------------------- Plans + Items ----------------------- */

/// `planKind` is "template" or "session".
#[tauri::command]
pub fn plan_get(
    db: State<'_, DbState>,
    plan_id: i64,
    plan_kind: String,
) -> Result<Plan, String> {
    let kind = PlanKind::from_str(&plan_kind).ok_or("invalid plan kind")?;
    lock(&db)?.get_plan(plan_id, kind).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn plan_add_item(
    db: State<'_, DbState>,
    plan_id: i64,
    plan_kind: String,
    item_type: String,
    item_data: String,
    order_index: f64,
    auto_advance_seconds: Option<i32>,
) -> Result<PlanItem, String> {
    let kind = PlanKind::from_str(&plan_kind).ok_or("invalid plan kind")?;
    let ty = PlanItemType::from_str(&item_type).ok_or("invalid item type")?;
    lock(&db)?
        .add_plan_item(plan_id, kind, ty, &item_data, order_index, auto_advance_seconds)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn plan_update_item(
    db: State<'_, DbState>,
    item_id: i64,
    item_data: String,
    auto_advance_seconds: Option<i32>,
) -> Result<(), String> {
    lock(&db)?
        .update_plan_item(item_id, &item_data, auto_advance_seconds)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn plan_reorder_item(
    db: State<'_, DbState>,
    item_id: i64,
    new_order_index: f64,
) -> Result<(), String> {
    lock(&db)?
        .reorder_plan_item(item_id, new_order_index)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn plan_delete_item(db: State<'_, DbState>, item_id: i64) -> Result<(), String> {
    lock(&db)?.delete_plan_item(item_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn plan_load_template_into_session(
    db: State<'_, DbState>,
    session_id: i64,
    template_id: i64,
) -> Result<(), String> {
    lock(&db)?
        .load_template_into_session(session_id, template_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn plan_clone_from_session(
    db: State<'_, DbState>,
    target_session_id: i64,
    source_session_id: i64,
) -> Result<(), String> {
    lock(&db)?
        .clone_session_plan(target_session_id, source_session_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn plan_save_session_as_template(
    db: State<'_, DbState>,
    session_id: i64,
    name: String,
    notes: Option<String>,
) -> Result<i64, String> {
    lock(&db)?
        .save_session_as_template(session_id, &name, notes.as_deref())
        .map_err(|e| e.to_string())
}
