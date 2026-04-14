use rhema_notes::SessionDb;
use rhema_notes::SermonSession;
use std::sync::Mutex;
use tauri::State;

type DbState = Mutex<SessionDb>;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AggregateStats {
    pub total_sessions: i64,
    pub total_detections: i64,
    pub total_hours: f64,
    pub top_book: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerseFrequency {
    pub verse_ref: String,
    pub count: i64,
}

#[tauri::command]
pub fn get_aggregate_stats(db: State<'_, DbState>) -> Result<AggregateStats, String> {
    let (total_sessions, total_detections, total_hours, top_book) = db
        .lock()
        .unwrap()
        .get_aggregate_stats()
        .map_err(|e| e.to_string())?;
    Ok(AggregateStats {
        total_sessions,
        total_detections,
        total_hours,
        top_book,
    })
}

#[tauri::command]
pub fn get_verse_frequency(db: State<'_, DbState>, limit: i64) -> Result<Vec<VerseFrequency>, String> {
    let rows = db
        .lock()
        .unwrap()
        .get_verse_frequency(limit)
        .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|(verse_ref, count)| VerseFrequency { verse_ref, count })
        .collect())
}

#[tauri::command]
pub fn get_recent_sessions(db: State<'_, DbState>, limit: i64) -> Result<Vec<SermonSession>, String> {
    db.lock()
        .unwrap()
        .get_recent_sessions(limit)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_session_detection_count(db: State<'_, DbState>, session_id: i64) -> Result<i64, String> {
    db.lock()
        .unwrap()
        .get_session_detection_count(session_id)
        .map_err(|e| e.to_string())
}
