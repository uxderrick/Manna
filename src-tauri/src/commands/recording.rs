use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::ipc::Response;
use tauri::{AppHandle, State};

use rhema_notes::SessionDb;

use super::storage::session_dir;

/// List `audio-seg-*.mp3` segment files in `dir`, sorted chronologically
/// (filenames embed a zero-padded millisecond timestamp, so a lexical sort is
/// chronological).
fn list_segments(dir: &Path) -> std::io::Result<Vec<PathBuf>> {
    let mut segments: Vec<PathBuf> = match std::fs::read_dir(dir) {
        Ok(rd) => rd
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with("audio-seg-") && n.ends_with(".mp3"))
            })
            .collect(),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };
    segments.sort();
    Ok(segments)
}

/// Concatenate any recording segments in `dir` into a single `audio.mp3`, then
/// delete the segments. MP3 frame streams (no mid-stream ID3 tags — see
/// `Mp3Writer`) concatenate losslessly by raw byte append.
///
/// Idempotent: with no segments it leaves any existing `audio.mp3` untouched.
/// If `audio.mp3` already exists, newer segments are appended after it so a
/// second concat round (e.g. recording resumed after a prior concat) extends
/// the same file. Returns the final path when audio exists, else `None`.
fn concat_segments(dir: &Path) -> std::io::Result<Option<PathBuf>> {
    use std::io::Write;

    let final_path = dir.join("audio.mp3");
    let segments = list_segments(dir)?;

    if segments.is_empty() {
        return Ok(final_path.exists().then(|| final_path.clone()));
    }

    let tmp = dir.join("audio.mp3.concat-tmp");
    {
        let mut out = std::io::BufWriter::new(std::fs::File::create(&tmp)?);
        if final_path.exists() {
            out.write_all(&std::fs::read(&final_path)?)?;
        }
        for seg in &segments {
            out.write_all(&std::fs::read(seg)?)?;
        }
        out.flush()?;
    }
    std::fs::rename(&tmp, &final_path)?;
    for seg in &segments {
        let _ = std::fs::remove_file(seg);
    }
    log::info!(
        "[REC] concatenated {} segment(s) → {}",
        segments.len(),
        final_path.display()
    );
    Ok(Some(final_path))
}

/// Concatenate this session's recording segments into the final `audio.mp3`.
///
/// Call from the frontend AFTER transcription has fully stopped (poll
/// `get_stt_status` until false) so no segment is mid-write. Safe to call when
/// recording was disabled — it's a no-op if there are no segments. Updates
/// `audio_path` to the final file, or clears it if no audio was produced.
#[tauri::command]
pub fn finalize_session_audio(
    app: AppHandle,
    db: State<'_, Mutex<SessionDb>>,
    session_id: i64,
) -> Result<Option<String>, String> {
    let dir = session_dir(&app, session_id);
    let final_path = concat_segments(&dir).map_err(|e| e.to_string())?;

    let db = db.lock().map_err(|e| e.to_string())?;
    match &final_path {
        Some(path) => {
            db.set_session_audio_path(session_id, &path.to_string_lossy())
                .map_err(|e| e.to_string())?;
            Ok(Some(path.to_string_lossy().into_owned()))
        }
        None => {
            // No audio for this session — clear any eagerly-set path.
            db.clear_session_audio_path(session_id).map_err(|e| e.to_string())?;
            Ok(None)
        }
    }
}

/// Read a session's recorded audio as raw bytes for in-app playback.
///
/// Returned as a binary `Response` (efficient IPC, not a JSON number array),
/// which `invoke` resolves to an `ArrayBuffer` the frontend wraps in a Blob.
/// We serve bytes over IPC instead of an `asset:` URL because Tauri's asset
/// protocol mishandles HTTP range requests for media on macOS WKWebView —
/// seeking a longer recording re-reads from byte 0 and crashes the WebView
/// renderer (tauri-apps/tauri#6375, #4826). A Blob URL seeks in-memory.
#[tauri::command]
pub fn read_session_audio(
    app: AppHandle,
    db: State<'_, Mutex<SessionDb>>,
    session_id: i64,
) -> Result<Response, String> {
    let path = {
        let db = db.lock().map_err(|e| e.to_string())?;
        let session = db.get_session(session_id).map_err(|e| e.to_string())?;
        session
            .audio_path
            .map(PathBuf::from)
            .unwrap_or_else(|| session_dir(&app, session_id).join("audio.mp3"))
    };
    let bytes = std::fs::read(&path)
        .map_err(|e| format!("Failed to read audio {}: {e}", path.display()))?;
    Ok(Response::new(bytes))
}

/// Delete all recorded audio for a session (final file + any leftover
/// segments) and clear the `audio_path` column. Idempotent.
#[tauri::command]
pub fn delete_session_audio(
    app: AppHandle,
    db: State<'_, Mutex<SessionDb>>,
    session_id: i64,
) -> Result<(), String> {
    // Remove the final file (path may be stored in DB or default location).
    let db = db.lock().map_err(|e| e.to_string())?;
    let session = db.get_session(session_id).map_err(|e| e.to_string())?;
    let final_path = session
        .audio_path
        .map(PathBuf::from)
        .unwrap_or_else(|| session_dir(&app, session_id).join("audio.mp3"));
    match std::fs::remove_file(&final_path) {
        Ok(()) => log::info!("[REC] deleted {}", final_path.display()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("Failed to delete {}: {e}", final_path.display())),
    }

    // Remove any leftover segments (e.g. session never finalized). Sweep the
    // recording's own directory as well as the configured one — a session
    // recorded before the root changed still has segments in the old place.
    let mut dirs = vec![session_dir(&app, session_id)];
    if let Some(parent) = final_path.parent() {
        if !dirs.contains(&parent.to_path_buf()) {
            dirs.push(parent.to_path_buf());
        }
    }
    for dir in &dirs {
        if let Ok(segments) = list_segments(dir) {
            for seg in segments {
                let _ = std::fs::remove_file(seg);
            }
        }
    }

    db.clear_session_audio_path(session_id)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rhema_notes::CreateSessionRequest;
    use tempfile::tempdir;

    #[test]
    fn delete_removes_file_and_clears_column() {
        let dir = tempdir().unwrap();
        let db = SessionDb::open(&dir.path().join("t.db")).unwrap();
        let session = db
            .create_session(&CreateSessionRequest {
                title: "T".into(),
                speaker: None,
                date: "2026-05-28".into(),
                series_name: None,
                tags: vec![],
                planned_scriptures: vec![],
            })
            .unwrap();
        let audio_path = dir.path().join("audio.mp3");
        std::fs::write(&audio_path, b"fake mp3").unwrap();
        db.set_session_audio_path(session.id, audio_path.to_str().unwrap())
            .unwrap();

        // Can't easily mock Tauri's `State`; assert the underlying DB+FS
        // contract the command relies on.
        std::fs::remove_file(&audio_path).unwrap();
        db.clear_session_audio_path(session.id).unwrap();
        let reloaded = db.get_session(session.id).unwrap();
        assert_eq!(reloaded.audio_path, None);
        assert!(!audio_path.exists());
    }

    #[test]
    fn concat_merges_segments_in_order_and_removes_them() {
        let dir = tempdir().unwrap();
        let p = dir.path();
        // Three out-of-creation-order writes; names sort chronologically.
        std::fs::write(p.join("audio-seg-0000000000002.mp3"), b"BBB").unwrap();
        std::fs::write(p.join("audio-seg-0000000000001.mp3"), b"AAA").unwrap();
        std::fs::write(p.join("audio-seg-0000000000003.mp3"), b"CCC").unwrap();

        let out = concat_segments(p).unwrap().unwrap();
        assert_eq!(out, p.join("audio.mp3"));
        assert_eq!(std::fs::read(&out).unwrap(), b"AAABBBCCC");

        // Segments removed after merge.
        assert!(list_segments(p).unwrap().is_empty());
    }

    #[test]
    fn concat_no_segments_is_noop() {
        let dir = tempdir().unwrap();
        assert_eq!(concat_segments(dir.path()).unwrap(), None);
    }

    #[test]
    fn concat_appends_to_existing_final() {
        let dir = tempdir().unwrap();
        let p = dir.path();
        std::fs::write(p.join("audio.mp3"), b"OLD").unwrap();
        std::fs::write(p.join("audio-seg-0000000000005.mp3"), b"NEW").unwrap();

        let out = concat_segments(p).unwrap().unwrap();
        assert_eq!(std::fs::read(&out).unwrap(), b"OLDNEW");
    }
}
