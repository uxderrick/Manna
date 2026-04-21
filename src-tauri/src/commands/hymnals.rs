use rhema_notes::SessionDb;
use std::sync::Mutex;
use tauri::State;

use crate::hymnals::{find_hymnal, HYMNALS};

type DbState = Mutex<SessionDb>;

#[tauri::command]
pub fn seed_hymnal(db: State<'_, DbState>, hymnal_id: String) -> Result<usize, String> {
    let def = find_hymnal(&hymnal_id)
        .ok_or_else(|| format!("Unknown hymnal id: {hymnal_id}"))?;

    let locked = db.lock().map_err(|e| e.to_string())?;
    let current = locked
        .max_hymnal_seed_version(def.id)
        .map_err(|e| e.to_string())?;
    if current >= def.seed_version {
        let count = locked
            .count_songs_by_source(def.id)
            .map_err(|e| e.to_string())?;
        return Ok(count as usize);
    }

    crate::seed_one_hymnal_public(&locked, def).map_err(|e| e.to_string())?;
    let count = locked
        .count_songs_by_source(def.id)
        .map_err(|e| e.to_string())?;
    Ok(count as usize)
}

#[tauri::command]
pub fn delete_hymnal_songs(db: State<'_, DbState>, hymnal_id: String) -> Result<usize, String> {
    let def = find_hymnal(&hymnal_id)
        .ok_or_else(|| format!("Unknown hymnal id: {hymnal_id}"))?;
    let locked = db.lock().map_err(|e| e.to_string())?;
    let deleted = locked
        .delete_songs_by_source(def.id)
        .map_err(|e| e.to_string())?;
    Ok(deleted)
}

#[tauri::command]
pub fn list_hymnal_counts(
    db: State<'_, DbState>,
) -> Result<Vec<(String, String, i64, i64)>, String> {
    let locked = db.lock().map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(HYMNALS.len());
    for def in HYMNALS {
        let count = locked
            .count_songs_by_source(def.id)
            .map_err(|e| e.to_string())?;
        let seed = locked
            .max_hymnal_seed_version(def.id)
            .map_err(|e| e.to_string())?;
        out.push((def.id.to_string(), def.name.to_string(), count, seed));
    }
    Ok(out)
}
