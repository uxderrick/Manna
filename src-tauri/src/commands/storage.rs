//! User-selectable storage location for session recordings.
//!
//! By default recordings live under `<app-data>/com.manna.app/sessions/`. The
//! user can point them at any writable directory (an external drive, a synced
//! folder) from Settings → Storage; the choice persists as `recordingsRoot` in
//! tauri-plugin-store's `settings.json`, which is also where the frontend
//! writes it.
//!
//! Only recordings are relocatable. The image library (`images.rs`), brand
//! assets (`assets.rs`) and `manna.db` stay under app data — the DB in
//! particular opens before the store is readable, so it has no chance to honor
//! a custom root.
//!
//! Sessions record an absolute `audio_path`, so recordings left behind in an
//! old root keep playing back after a change. `move_recordings_root` copies the
//! tree over and rewrites those rows for users who'd rather bring them along.

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Mutex;

use tauri::{AppHandle, State};
use tauri_plugin_store::StoreExt;

use rhema_notes::SessionDb;

use crate::state::AppState;

/// Reject a root change while audio is being captured.
///
/// Segments are written to the directory resolved at `start_transcription`,
/// but `finalize_session_audio` concatenates from the directory resolved at
/// End Session. Moving the root in between would leave finalize looking in an
/// empty folder and silently drop the service's recording.
fn ensure_not_recording(state: &State<'_, Mutex<AppState>>) -> Result<(), String> {
    let active = {
        let app_state = state.lock().map_err(|e| e.to_string())?;
        app_state.stt_active.load(Ordering::Relaxed)
            || app_state.audio_active.load(Ordering::Relaxed)
    };
    if active {
        return Err("Stop the current session before changing the recording folder.".into());
    }
    Ok(())
}

/// Directory holding all per-session recording folders, absent any override.
pub fn default_recordings_root() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.manna.app")
        .join("sessions")
}

/// Read the user's custom recordings root from `settings.json`, if set.
///
/// A blank or whitespace-only value is treated as unset so a cleared field in
/// the store can't redirect recordings to the process working directory.
fn stored_recordings_root(app: &AppHandle) -> Option<PathBuf> {
    let store = app.store("settings.json").ok()?;
    let value = store.get("recordingsRoot")?;
    let path = value.as_str()?.trim().to_string();
    (!path.is_empty()).then(|| PathBuf::from(path))
}

/// Directory holding all per-session recording folders, honoring the user's
/// choice. Falls back to the default root when no override is set.
pub fn recordings_root(app: &AppHandle) -> PathBuf {
    stored_recordings_root(app).unwrap_or_else(default_recordings_root)
}

/// Directory for one session's recording segments and final `audio.mp3`.
pub fn session_dir(app: &AppHandle, session_id: i64) -> PathBuf {
    recordings_root(app).join(session_id.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingsLocation {
    /// The directory currently in use.
    pub path: String,
    /// The built-in app-data location, shown as the "Default" choice.
    pub default_path: String,
    /// False when the user has pointed recordings elsewhere.
    pub is_default: bool,
}

/// Report where recordings are being written, for the Storage settings panel.
#[tauri::command]
pub fn get_recordings_location(app: AppHandle) -> RecordingsLocation {
    let default_path = default_recordings_root();
    let path = recordings_root(&app);
    RecordingsLocation {
        is_default: path == default_path,
        path: path.to_string_lossy().into_owned(),
        default_path: default_path.to_string_lossy().into_owned(),
    }
}

/// Reject a candidate root that we can't actually record into, so the failure
/// surfaces at pick time rather than silently at the start of a service.
///
/// Writability is probed with a real temp file: `create_dir_all` succeeding
/// says nothing about a read-only mount or a permission-gated folder.
fn validate_root(root: &Path) -> Result<(), String> {
    if root.is_relative() {
        return Err("Choose an absolute path for the recordings folder.".into());
    }
    if root.is_file() {
        return Err(format!("{} is a file, not a folder.", root.display()));
    }
    std::fs::create_dir_all(root)
        .map_err(|e| format!("Can't create {}: {e}", root.display()))?;

    let probe = root.join(".manna-write-test");
    std::fs::write(&probe, b"")
        .map_err(|e| format!("Can't write to {}: {e}", root.display()))?;
    let _ = std::fs::remove_file(&probe);
    Ok(())
}

/// Point future recordings at `path` (or back at the default when `None`).
///
/// Existing recordings stay where they are and keep playing back — their
/// absolute paths are stored per session. Call `move_recordings_root` first to
/// bring them along. Rejected while a session is recording.
#[tauri::command]
pub fn set_recordings_root(
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
    path: Option<String>,
) -> Result<RecordingsLocation, String> {
    ensure_not_recording(&state)?;

    let trimmed = path.map(|p| p.trim().to_string()).filter(|p| !p.is_empty());
    let store = app.store("settings.json").map_err(|e| e.to_string())?;

    if let Some(p) = &trimmed {
        let root = PathBuf::from(p);
        validate_root(&root)?;
        store.set("recordingsRoot", serde_json::json!(root.to_string_lossy()));
        log::info!("[storage] recordings root set to {}", root.display());
    } else {
        store.delete("recordingsRoot");
        log::info!("[storage] recordings root reset to default");
    }
    store.save().map_err(|e| e.to_string())?;

    Ok(get_recordings_location(app))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveOutcome {
    /// Number of session folders copied to the new root.
    pub moved: usize,
    /// Session folders left behind because they failed to copy.
    pub failed: Vec<String>,
}

/// Recursively copy `src` into `dst`, creating `dst` as needed.
fn copy_dir(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

/// Copy every existing session recording folder into `dest`, rewrite the
/// affected `audio_path` rows, then delete the originals.
///
/// Copy-then-delete rather than rename: the new root is often on a different
/// filesystem (external drive), where `rename` fails outright. Each session
/// folder is handled independently — one unreadable folder is reported in
/// `failed` and leaves the rest of the move intact, and a folder is only
/// deleted from the old root after its copy and DB update both succeed, so a
/// failure mid-way never destroys the sole copy of a recording.
///
/// Does not itself change the configured root; call `set_recordings_root`
/// after this succeeds.
#[tauri::command]
pub fn move_recordings_root(
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
    db: State<'_, Mutex<SessionDb>>,
    dest: String,
) -> Result<MoveOutcome, String> {
    ensure_not_recording(&state)?;
    let db = db.lock().map_err(|e| e.to_string())?;
    move_recordings(&recordings_root(&app), Path::new(dest.trim()), &db)
}

/// Path/DB core of `move_recordings_root`, free of Tauri state so it can be
/// driven directly by tests.
fn move_recordings(src_root: &Path, dest_root: &Path, db: &SessionDb) -> Result<MoveOutcome, String> {
    validate_root(dest_root)?;

    let src_canon = src_root.canonicalize().unwrap_or_else(|_| src_root.to_path_buf());
    let dest_canon = dest_root.canonicalize().unwrap_or_else(|_| dest_root.to_path_buf());
    if src_canon == dest_canon {
        return Ok(MoveOutcome { moved: 0, failed: Vec::new() });
    }
    if dest_canon.starts_with(&src_canon) {
        return Err("Choose a folder outside the current recordings folder.".into());
    }

    let entries = match std::fs::read_dir(src_root) {
        Ok(rd) => rd,
        // Nothing recorded yet — a move is trivially complete.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(MoveOutcome { moved: 0, failed: Vec::new() })
        }
        Err(e) => return Err(format!("Can't read {}: {e}", src_root.display())),
    };

    let mut moved = 0_usize;
    let mut failed = Vec::new();

    for entry in entries.flatten() {
        let from = entry.path();
        if !from.is_dir() {
            continue;
        }
        // Session folders are named by session id; skip anything else.
        let Some(session_id) = from
            .file_name()
            .and_then(|n| n.to_str())
            .and_then(|n| n.parse::<i64>().ok())
        else {
            continue;
        };

        let to = dest_root.join(session_id.to_string());
        if let Err(e) = copy_dir(&from, &to) {
            log::warn!("[storage] copy {} → {} failed: {e}", from.display(), to.display());
            let _ = std::fs::remove_dir_all(&to);
            failed.push(session_id.to_string());
            continue;
        }

        // Only sessions whose audio lived in the old root get repointed; one
        // that was recorded elsewhere keeps its own path.
        let audio = to.join("audio.mp3");
        if audio.is_file() {
            if let Err(e) = db.set_session_audio_path(session_id, &audio.to_string_lossy()) {
                log::warn!("[storage] audio_path update for session {session_id} failed: {e}");
                let _ = std::fs::remove_dir_all(&to);
                failed.push(session_id.to_string());
                continue;
            }
        }

        if let Err(e) = std::fs::remove_dir_all(&from) {
            // Copy and DB row are good; the stale original is cosmetic.
            log::warn!("[storage] could not remove {} after move: {e}", from.display());
        }
        moved += 1;
    }

    log::info!(
        "[storage] moved {moved} session folder(s) to {} ({} failed)",
        dest_root.display(),
        failed.len()
    );
    Ok(MoveOutcome { moved, failed })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn validate_root_rejects_relative_and_file_paths() {
        assert!(validate_root(Path::new("relative/dir")).is_err());

        let dir = tempdir().unwrap();
        let file = dir.path().join("a.txt");
        std::fs::write(&file, b"x").unwrap();
        assert!(validate_root(&file).is_err());
    }

    #[test]
    fn validate_root_creates_dir_and_leaves_no_probe_behind() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("new/nested/root");
        validate_root(&root).unwrap();
        assert!(root.is_dir());
        assert!(!root.join(".manna-write-test").exists());
    }

    /// Create a session with a recording at `<root>/<id>/audio.mp3`.
    fn seed_session(db: &SessionDb, root: &Path, title: &str, bytes: &[u8]) -> i64 {
        use rhema_notes::CreateSessionRequest;
        let session = db
            .create_session(&CreateSessionRequest {
                title: title.into(),
                speaker: None,
                date: "2026-07-15".into(),
                series_name: None,
                tags: vec![],
                planned_scriptures: vec![],
            })
            .unwrap();
        let dir = root.join(session.id.to_string());
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("audio.mp3"), bytes).unwrap();
        db.set_session_audio_path(session.id, dir.join("audio.mp3").to_str().unwrap())
            .unwrap();
        session.id
    }

    #[test]
    fn move_relocates_files_and_repoints_audio_paths() {
        let tmp = tempdir().unwrap();
        let db = SessionDb::open(&tmp.path().join("t.db")).unwrap();
        let src = tmp.path().join("old-root");
        let dest = tmp.path().join("new-root");
        std::fs::create_dir_all(&src).unwrap();

        let a = seed_session(&db, &src, "First", b"AAA");
        let b = seed_session(&db, &src, "Second", b"BBB");

        let outcome = move_recordings(&src, &dest, &db).unwrap();
        assert_eq!(outcome.moved, 2);
        assert!(outcome.failed.is_empty());

        // Bytes landed in the new root, originals are gone.
        assert_eq!(std::fs::read(dest.join(format!("{a}/audio.mp3"))).unwrap(), b"AAA");
        assert_eq!(std::fs::read(dest.join(format!("{b}/audio.mp3"))).unwrap(), b"BBB");
        assert!(!src.join(a.to_string()).exists());

        // Playback follows: DB now points at the new location.
        let reloaded = db.get_session(a).unwrap();
        assert_eq!(reloaded.audio_path, Some(dest.join(format!("{a}/audio.mp3")).to_string_lossy().into_owned()));
    }

    #[test]
    fn move_into_same_root_is_a_noop() {
        let tmp = tempdir().unwrap();
        let db = SessionDb::open(&tmp.path().join("t.db")).unwrap();
        let src = tmp.path().join("root");
        std::fs::create_dir_all(&src).unwrap();
        let id = seed_session(&db, &src, "Keep", b"AAA");

        let outcome = move_recordings(&src, &src, &db).unwrap();
        assert_eq!(outcome.moved, 0);
        // The recording survives an accidental move-onto-itself.
        assert_eq!(std::fs::read(src.join(format!("{id}/audio.mp3"))).unwrap(), b"AAA");
    }

    #[test]
    fn move_rejects_destination_nested_in_source() {
        let tmp = tempdir().unwrap();
        let db = SessionDb::open(&tmp.path().join("t.db")).unwrap();
        let src = tmp.path().join("root");
        std::fs::create_dir_all(&src).unwrap();

        assert!(move_recordings(&src, &src.join("inner"), &db).is_err());
    }

    #[test]
    fn move_ignores_non_session_entries() {
        let tmp = tempdir().unwrap();
        let db = SessionDb::open(&tmp.path().join("t.db")).unwrap();
        let src = tmp.path().join("old");
        let dest = tmp.path().join("new");
        std::fs::create_dir_all(src.join("not-a-session")).unwrap();
        std::fs::write(src.join("stray.txt"), b"x").unwrap();

        let outcome = move_recordings(&src, &dest, &db).unwrap();
        assert_eq!(outcome.moved, 0);
        assert!(!dest.join("not-a-session").exists());
    }

    #[test]
    fn copy_dir_copies_nested_contents() {
        let dir = tempdir().unwrap();
        let src = dir.path().join("src");
        std::fs::create_dir_all(src.join("inner")).unwrap();
        std::fs::write(src.join("audio.mp3"), b"AAA").unwrap();
        std::fs::write(src.join("inner/seg.mp3"), b"BBB").unwrap();

        let dst = dir.path().join("dst");
        copy_dir(&src, &dst).unwrap();

        assert_eq!(std::fs::read(dst.join("audio.mp3")).unwrap(), b"AAA");
        assert_eq!(std::fs::read(dst.join("inner/seg.mp3")).unwrap(), b"BBB");
        // Source is untouched — the caller deletes it only after a good copy.
        assert!(src.join("audio.mp3").is_file());
    }
}
