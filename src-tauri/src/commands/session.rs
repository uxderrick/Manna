use rhema_notes::{
    AddDetectionRequest, AddDistributionRequest, AddNoteRequest, AddTranscriptRequest,
    CreateSessionRequest, SermonSession, SessionDb, SessionDetection, SessionDistribution,
    SessionNote, SessionTranscriptSegment,
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
pub fn delete_session(
    state: State<'_, Mutex<crate::state::AppState>>,
    db: State<'_, DbState>, id: i64,
) -> Result<(), String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    let db = db.lock().map_err(|e| e.to_string())?;
    delete_idle_session(&state, &db, id)
}

#[tauri::command]
pub fn update_session_title(
    db: State<'_, DbState>,
    id: i64,
    title: String,
) -> Result<(), String> {
    db.lock()
        .map_err(|e| e.to_string())?
        .update_session_title(id, &title)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_session_series(
    db: State<'_, DbState>,
    id: i64,
    series: Option<String>,
) -> Result<(), String> {
    db.lock()
        .map_err(|e| e.to_string())?
        .update_session_series(id, series.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_session_tags(
    db: State<'_, DbState>,
    id: i64,
    tags_json: String,
) -> Result<(), String> {
    db.lock()
        .map_err(|e| e.to_string())?
        .update_session_tags(id, &tags_json)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_transcript_segment(
    db: State<'_, DbState>,
    segment_id: i64,
    text: String,
) -> Result<(), String> {
    db.lock()
        .map_err(|e| e.to_string())?
        .update_transcript_segment(segment_id, &text)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_transcript_segment(
    db: State<'_, DbState>,
    segment_id: i64,
) -> Result<(), String> {
    db.lock()
        .map_err(|e| e.to_string())?
        .delete_transcript_segment(segment_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_session_series(db: State<'_, DbState>) -> Result<Vec<String>, String> {
    db.lock()
        .map_err(|e| e.to_string())?
        .list_session_series()
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
pub fn record_presented_verse(
    db: State<'_, DbState>,
    session_id: i64,
    verse_ref: String,
    verse_text: String,
    translation: String,
) -> Result<(), String> {
    db.lock()
        .map_err(|e| e.to_string())?
        .record_presented_verse(session_id, &verse_ref, &verse_text, &translation)
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

#[tauri::command]
pub fn update_session_note(
    db: State<'_, DbState>,
    id: i64,
    content: String,
) -> Result<(), String> {
    db.lock()
        .map_err(|e| e.to_string())?
        .update_note(id, &content)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_distribution(
    db: State<'_, DbState>,
    request: AddDistributionRequest,
) -> Result<SessionDistribution, String> {
    db.lock()
        .map_err(|e| e.to_string())?
        .add_distribution(&request)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_distributions(
    db: State<'_, DbState>,
    session_id: i64,
) -> Result<Vec<SessionDistribution>, String> {
    db.lock()
        .map_err(|e| e.to_string())?
        .list_distributions(session_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn mark_distribution_sent(db: State<'_, DbState>, id: i64) -> Result<(), String> {
    db.lock()
        .map_err(|e| e.to_string())?
        .mark_distribution_sent(id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn mark_distribution_failed(db: State<'_, DbState>, id: i64) -> Result<(), String> {
    db.lock()
        .map_err(|e| e.to_string())?
        .mark_distribution_failed(id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_distribution(db: State<'_, DbState>, id: i64) -> Result<(), String> {
    db.lock()
        .map_err(|e| e.to_string())?
        .delete_distribution(id)
        .map_err(|e| e.to_string())
}

fn delete_idle_session(state: &crate::state::AppState, db: &SessionDb, id: i64) -> Result<(), String> {
    state.ensure_session_audio_idle(id)?;
    db.delete_session(id).map_err(|e| e.to_string())
}

#[cfg(test)]
mod deletion_tests {
    use super::*;
    use std::sync::atomic::Ordering;
    fn fixture() -> (tempfile::TempDir, SessionDb, i64) {
        let dir = tempfile::tempdir().unwrap();
        let db = SessionDb::open(&dir.path().join("sessions.db")).unwrap();
        let s = db.create_session(&CreateSessionRequest {
            title: "Synthetic session".into(), title_is_automatic: false,
            speaker: None, date: "2026-10-23".into(), series_name: None,
            tags: vec![], planned_scriptures: vec![],
        }).unwrap();
        db.start_session(s.id).unwrap();
        (dir, db, s.id)
    }
    #[test]
    fn active_and_stopping_sessions_cannot_be_deleted() {
        for stopping in [false,true] {
            let (_dir, db, id) = fixture();
            let mut state = crate::state::AppState::new();
            state.transcription_session_id = Some(id);
            state.stt_stopping = stopping;
            state.stt_active.store(!stopping, Ordering::SeqCst);
            assert!(delete_idle_session(&state, &db, id).is_err());
            assert!(db.get_session(id).is_ok());
        }
    }
    #[test]
    fn inactive_session_can_be_deleted_while_another_is_recording() {
        let (_dir, db, id) = fixture();
        let mut state = crate::state::AppState::new();
        state.transcription_session_id = Some(id+1);
        state.stt_active.store(true, Ordering::SeqCst);
        delete_idle_session(&state, &db, id).unwrap();
        assert!(db.get_session(id).is_err());
    }
}
