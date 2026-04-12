use rhema_notes::{
    AddDetectionRequest, AddNoteRequest, AddTranscriptRequest, CreateSessionRequest, SermonSession,
    SessionDb, SessionDetection, SessionNote, SessionTranscriptSegment,
};
use std::sync::Mutex;
use tauri::State;

type DbState = Mutex<SessionDb>;

#[tauri::command]
pub fn create_session(
    db: State<'_, DbState>,
    request: CreateSessionRequest,
) -> Result<SermonSession, String> {
    db.lock()
        .map_err(|e| e.to_string())?
        .create_session(&request)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_session(db: State<'_, DbState>, id: i64) -> Result<SermonSession, String> {
    db.lock()
        .map_err(|e| e.to_string())?
        .get_session(id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_sessions(db: State<'_, DbState>) -> Result<Vec<SermonSession>, String> {
    db.lock()
        .map_err(|e| e.to_string())?
        .list_sessions()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn start_session(db: State<'_, DbState>, id: i64) -> Result<SermonSession, String> {
    db.lock()
        .map_err(|e| e.to_string())?
        .start_session(id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn end_session(db: State<'_, DbState>, id: i64) -> Result<SermonSession, String> {
    db.lock()
        .map_err(|e| e.to_string())?
        .end_session(id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_session(db: State<'_, DbState>, id: i64) -> Result<(), String> {
    db.lock()
        .map_err(|e| e.to_string())?
        .delete_session(id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_session_summary(
    db: State<'_, DbState>,
    id: i64,
    summary: String,
) -> Result<(), String> {
    db.lock()
        .map_err(|e| e.to_string())?
        .update_session_summary(id, &summary)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_session_detection(
    db: State<'_, DbState>,
    request: AddDetectionRequest,
) -> Result<SessionDetection, String> {
    db.lock()
        .map_err(|e| e.to_string())?
        .add_detection(&request)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_session_detections(
    db: State<'_, DbState>,
    session_id: i64,
) -> Result<Vec<SessionDetection>, String> {
    db.lock()
        .map_err(|e| e.to_string())?
        .get_session_detections(session_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_session_transcript(
    db: State<'_, DbState>,
    request: AddTranscriptRequest,
) -> Result<(), String> {
    db.lock()
        .map_err(|e| e.to_string())?
        .add_transcript(&request)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_session_transcript(
    db: State<'_, DbState>,
    session_id: i64,
) -> Result<Vec<SessionTranscriptSegment>, String> {
    db.lock()
        .map_err(|e| e.to_string())?
        .get_session_transcript(session_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_session_note(
    db: State<'_, DbState>,
    request: AddNoteRequest,
) -> Result<SessionNote, String> {
    db.lock()
        .map_err(|e| e.to_string())?
        .add_note(&request)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_session_notes(
    db: State<'_, DbState>,
    session_id: i64,
) -> Result<Vec<SessionNote>, String> {
    db.lock()
        .map_err(|e| e.to_string())?
        .get_session_notes(session_id)
        .map_err(|e| e.to_string())
}
