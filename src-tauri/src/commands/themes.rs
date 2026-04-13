use rhema_notes::SessionDb;
use std::sync::Mutex;
use tauri::State;

type DbState = Mutex<SessionDb>;

#[tauri::command]
pub fn list_custom_themes(
    db: State<'_, DbState>,
) -> Result<Vec<(String, String, String)>, String> {
    db.lock()
        .unwrap()
        .list_custom_themes()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_custom_theme(
    db: State<'_, DbState>,
    id: String,
    name: String,
    theme_json: String,
) -> Result<(), String> {
    db.lock()
        .unwrap()
        .save_custom_theme(&id, &name, &theme_json)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_custom_theme(
    db: State<'_, DbState>,
    id: String,
) -> Result<(), String> {
    db.lock()
        .unwrap()
        .delete_custom_theme(&id)
        .map_err(|e| e.to_string())
}
