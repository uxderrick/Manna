//! Song detection by sound: recognise which song is being sung or played.
//!
//! The engine lives in `rhema-songmatch`; this module connects it to Manna:
//!
//! - fingerprints are stored per song in `song_fingerprints` (see
//!   `rhema_notes::song_fingerprints`), made by the operator from a
//!   recording ("prepare for detection") or learned from songs the operator
//!   confirms during a service;
//! - the capture fan-out hands every microphone frame to
//!   [`SongDetectionRuntime::feed`], which never blocks it;
//! - a worker thread runs the matcher and emits [`EVENT_SONG_DETECTION`]
//!   with the current decision (listening, top-3 suggestions, or a commit).
//!
//! The CLEWS model (`clews_int8.onnx`, about 208 MB) is not bundled yet. It
//! is looked for in the app data folder, then the resources, then (in
//! development) the checkout, under `models/songmatch/`.
#![expect(
    clippy::needless_pass_by_value,
    reason = "Tauri command extractors require pass-by-value"
)]

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use crossbeam_channel::{Receiver, Sender, TrySendError};
use rhema_notes::{SessionDb, SongFingerprint, SongFingerprintInfo};
use rhema_songmatch::embedder::{embed_reference, Embedder};
use rhema_songmatch::library::{Library, Reference, Source};
use rhema_songmatch::listener::{Learned, ListenerConfig, Matcher, Update};
use rhema_songmatch::policy::Decision;
use rhema_songmatch::{EMBED_DIM, SAMPLE_RATE_HZ};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

/// Fingerprints made by another model are ignored, never compared.
pub const MODEL_ID: &str = "clews-dvi-int8-v1";
const MODEL_RELATIVE: &str = "models/songmatch/clews_int8.onnx";
/// Intra-op threads for the model; leaves room for speech recognition.
const MODEL_THREADS: usize = 2;
/// About 50 s of 1024-sample frames: plenty while a check runs.
const QUEUE_FRAMES: usize = 800;
/// Shortest recording worth enrolling, in seconds.
const MIN_ENROL_S: f32 = 10.0;

pub const EVENT_SONG_DETECTION: &str = "song_detection";
pub const EVENT_SONG_FINGERPRINTS_CHANGED: &str = "song_fingerprints_changed";

type DbState = Mutex<SessionDb>;

enum Msg {
    Audio(Vec<i16>),
    Plan(Vec<String>),
    Reset,
    Reload(Library),
    Learn { song_id: String, reference_id: String, reply: Sender<Result<Option<Learned>, String>> },
}

struct Engine {
    embedder: Arc<dyn Embedder>,
    tx: Sender<Msg>,
}

/// Shared state; `feed` is called from the audio thread for every frame.
#[derive(Default)]
pub struct SongDetectionRuntime {
    listening: AtomicBool,
    engine: Mutex<Option<Engine>>,
}

impl SongDetectionRuntime {
    /// Hand a capture frame to the matcher. Never blocks: when the engine is
    /// busy or off, the frame is dropped.
    pub fn feed(&self, pcm: &[i16]) {
        if !self.listening.load(Ordering::Relaxed) {
            return;
        }
        if let Ok(guard) = self.engine.try_lock() {
            if let Some(engine) = guard.as_ref() {
                if let Err(TrySendError::Full(_)) = engine.tx.try_send(Msg::Audio(pcm.to_vec())) {
                    log::debug!("[SONG] matcher behind; frame dropped");
                }
            }
        }
    }

    fn send(&self, msg: Msg) -> bool {
        self.engine
            .lock()
            .ok()
            .and_then(|g| g.as_ref().map(|e| e.tx.send(msg).is_ok()))
            .unwrap_or(false)
    }

    fn embedder(&self) -> Option<Arc<dyn Embedder>> {
        self.engine.lock().ok()?.as_ref().map(|e| Arc::clone(&e.embedder))
    }

    fn is_loaded(&self) -> bool {
        self.engine.lock().is_ok_and(|g| g.is_some())
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SongDetectionPayload {
    pub heard_seconds: f32,
    pub decision: Decision,
    /// First commit to this song in this stretch of music: time to present it.
    pub new_commit: bool,
}

impl From<Update> for SongDetectionPayload {
    fn from(u: Update) -> Self {
        Self { heard_seconds: u.heard_s, decision: u.decision, new_commit: u.new_commit }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SongDetectionStatus {
    /// This build can run the model at all.
    pub supported: bool,
    pub model_path: Option<String>,
    pub loaded: bool,
    pub listening: bool,
    /// Songs with at least one fingerprint, and the fingerprint count.
    pub songs: usize,
    pub fingerprints: usize,
}

fn model_candidates(app: &AppHandle) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(dir) = app.path().app_data_dir() {
        out.push(dir.join(MODEL_RELATIVE));
    }
    if let Ok(dir) = app.path().resource_dir() {
        out.push(dir.join(MODEL_RELATIVE));
    }
    if cfg!(debug_assertions) {
        out.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join(MODEL_RELATIVE));
    }
    out
}

fn model_path(app: &AppHandle) -> Option<PathBuf> {
    model_candidates(app).into_iter().find(|p| p.is_file())
}

#[cfg(feature = "onnx")]
fn load_embedder(path: &std::path::Path) -> Result<Arc<dyn Embedder>, String> {
    rhema_songmatch::embedder::OnnxEmbedder::load(path, MODEL_THREADS)
        .map(|e| Arc::new(e) as Arc<dyn Embedder>)
        .map_err(|e| format!("Could not load the song detection model: {e}"))
}

#[cfg(not(feature = "onnx"))]
fn load_embedder(_path: &std::path::Path) -> Result<Arc<dyn Embedder>, String> {
    let _ = MODEL_THREADS;
    Err("Song detection is not included in this build.".into())
}

fn source_of(name: &str) -> Option<Source> {
    match name {
        "library" => Some(Source::Library),
        "operator" => Some(Source::Operator),
        "live" => Some(Source::Live),
        _ => None,
    }
}

fn source_name(source: Source) -> &'static str {
    match source {
        Source::Library => "library",
        Source::Operator => "operator",
        Source::Live => "live",
    }
}

/// The matcher's library from stored fingerprints (this model's only).
pub fn library_from(fingerprints: Vec<SongFingerprint>) -> Library {
    let mut lib = Library::new();
    for fp in fingerprints {
        let Some(source) = source_of(&fp.source) else { continue };
        if fp.embeddings.is_empty() || fp.embeddings.iter().any(|e| e.len() != EMBED_DIM) {
            log::warn!("[SONG] fingerprint {} has the wrong size; skipped", fp.id);
            continue;
        }
        lib.add(Reference { id: fp.id, song_id: fp.song_id, source, embeddings: fp.embeddings });
    }
    lib.recalibrate();
    lib
}

fn load_library(db: &DbState) -> Result<Library, String> {
    let fingerprints = db.lock().map_err(|e| e.to_string())?.list_song_fingerprints(MODEL_ID).map_err(|e| e.to_string())?;
    Ok(library_from(fingerprints))
}

fn to_stored(reference: &Reference) -> SongFingerprint {
    SongFingerprint {
        id: reference.id.clone(),
        song_id: reference.song_id.clone(),
        source: source_name(reference.source).into(),
        model: MODEL_ID.into(),
        embeddings: reference.embeddings.clone(),
    }
}

fn run_worker(app: AppHandle, embedder: Arc<dyn Embedder>, library: Library, rx: Receiver<Msg>) {
    let mut matcher = Matcher::new(library, ListenerConfig::default());
    for msg in rx {
        match msg {
            Msg::Audio(pcm) => match matcher.push_i16(&pcm, embedder.as_ref()) {
                Ok(Some(update)) => {
                    let _ = app.emit(EVENT_SONG_DETECTION, SongDetectionPayload::from(update));
                }
                Ok(None) => {}
                Err(e) => log::warn!("[SONG] check failed: {e}"),
            },
            Msg::Plan(plan) => matcher.set_plan(plan),
            Msg::Reset => matcher.reset(),
            Msg::Reload(library) => matcher.set_library(library),
            Msg::Learn { song_id, reference_id, reply } => {
                let result = matcher.learn(&song_id, &reference_id, embedder.as_ref()).map_err(|e| e.to_string());
                let _ = reply.send(result);
            }
        }
    }
    log::info!("[SONG] matcher stopped");
}

/// Load the model and start the matcher, once.
async fn ensure_engine(app: &AppHandle) -> Result<(), String> {
    let runtime = app.state::<SongDetectionRuntime>();
    if runtime.is_loaded() {
        return Ok(());
    }
    let path = model_path(app).ok_or_else(|| {
        "The song detection model is not installed (models/songmatch/clews_int8.onnx).".to_string()
    })?;
    let embedder = tauri::async_runtime::spawn_blocking(move || load_embedder(&path)).await.map_err(|e| e.to_string())??;
    let library = load_library(&app.state::<DbState>())?;
    let mut engine = runtime.engine.lock().map_err(|e| e.to_string())?;
    if engine.is_some() {
        return Ok(()); // loaded meanwhile by another call
    }
    let (tx, rx) = crossbeam_channel::bounded(QUEUE_FRAMES);
    let worker_app = app.clone();
    let worker_embedder = Arc::clone(&embedder);
    std::thread::Builder::new()
        .name("song-matcher".into())
        .spawn(move || run_worker(worker_app, worker_embedder, library, rx))
        .map_err(|e| e.to_string())?;
    *engine = Some(Engine { embedder, tx });
    log::info!("[SONG] song detection ready");
    Ok(())
}

/// Re-read fingerprints into a running matcher.
fn reload(runtime: &SongDetectionRuntime, db: &DbState) -> Result<(), String> {
    if runtime.is_loaded() {
        runtime.send(Msg::Reload(load_library(db)?));
    }
    Ok(())
}

fn changed(app: &AppHandle) {
    let _ = app.emit(EVENT_SONG_FINGERPRINTS_CHANGED, ());
}

#[tauri::command]
pub fn get_song_detection_status(
    app: AppHandle,
    runtime: State<'_, SongDetectionRuntime>,
    db: State<'_, DbState>,
) -> Result<SongDetectionStatus, String> {
    let info = db.lock().map_err(|e| e.to_string())?.song_fingerprint_info(None).map_err(|e| e.to_string())?;
    let mine: Vec<&SongFingerprintInfo> = info.iter().filter(|i| i.model == MODEL_ID).collect();
    let mut songs: Vec<&str> = mine.iter().map(|i| i.song_id.as_str()).collect();
    songs.sort_unstable();
    songs.dedup();
    Ok(SongDetectionStatus {
        supported: cfg!(feature = "onnx"),
        model_path: model_path(&app).map(|p| p.display().to_string()),
        loaded: runtime.is_loaded(),
        listening: runtime.listening.load(Ordering::Relaxed),
        songs: songs.len(),
        fingerprints: mine.len(),
    })
}

/// Turn listening on or off (loads the model the first time).
#[tauri::command]
pub async fn set_song_detection_listening(app: AppHandle, enabled: bool) -> Result<(), String> {
    let runtime = app.state::<SongDetectionRuntime>();
    if enabled {
        ensure_engine(&app).await?;
    }
    runtime.listening.store(enabled, Ordering::Relaxed);
    runtime.send(Msg::Reset);
    Ok(())
}

/// Song ids in the current service plan (empty: any song).
#[tauri::command]
pub fn set_song_detection_plan(runtime: State<'_, SongDetectionRuntime>, song_ids: Vec<String>) {
    runtime.send(Msg::Plan(song_ids));
}

/// Forget what has been heard (e.g. the operator moved on).
#[tauri::command]
pub fn reset_song_detection(runtime: State<'_, SongDetectionRuntime>) {
    runtime.send(Msg::Reset);
}

/// The operator confirmed `song_id` is being sung: learn from what was
/// heard so the song is recognised sooner next time. Returns whether a
/// fingerprint was kept (too little audio keeps nothing).
#[tauri::command]
pub async fn confirm_detected_song(app: AppHandle, song_id: String) -> Result<bool, String> {
    let runtime = app.state::<SongDetectionRuntime>();
    if !runtime.is_loaded() {
        return Ok(false);
    }
    let (reply, answer) = crossbeam_channel::bounded(1);
    let reference_id = format!("live-{}", uuid::Uuid::new_v4());
    if !runtime.send(Msg::Learn { song_id, reference_id, reply }) {
        return Ok(false);
    }
    let learned = tauri::async_runtime::spawn_blocking(move || answer.recv().map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())???;
    let Some(learned) = learned else { return Ok(false) };
    {
        let db = app.state::<DbState>();
        let db = db.lock().map_err(|e| e.to_string())?;
        db.save_song_fingerprint(&to_stored(&learned.reference)).map_err(|e| e.to_string())?;
        db.delete_song_fingerprints(&learned.dropped).map_err(|e| e.to_string())?;
    }
    changed(&app);
    Ok(true)
}

/// "Prepare for detection": a recording of a song, decoded by the frontend
/// to 16 kHz mono and sent as raw little-endian `f32` bytes, with the song
/// id in the `song-id` header. Stores its fingerprint (not the audio).
#[tauri::command]
pub async fn enroll_song_audio(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<SongFingerprintInfo, String> {
    let song_id = request
        .headers()
        .get("song-id")
        .and_then(|v| v.to_str().ok())
        .filter(|s| !s.is_empty())
        .ok_or("Missing song id.")?
        .to_string();
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected raw audio bytes.".into());
    };
    let audio: Vec<f32> = bytes.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
    #[expect(clippy::cast_precision_loss, reason = "recordings are minutes long")]
    let seconds = audio.len() as f32 / SAMPLE_RATE_HZ;
    if seconds < MIN_ENROL_S {
        return Err(format!("The recording is too short ({seconds:.0} s); use at least {MIN_ENROL_S:.0} s."));
    }
    ensure_engine(&app).await?;
    let runtime = app.state::<SongDetectionRuntime>();
    let embedder = runtime.embedder().ok_or("Song detection is not loaded.")?;
    let embeddings = tauri::async_runtime::spawn_blocking(move || embed_reference(embedder.as_ref(), &audio))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    let fp = SongFingerprint {
        id: format!("operator-{}", uuid::Uuid::new_v4()),
        song_id: song_id.clone(),
        source: "operator".into(),
        model: MODEL_ID.into(),
        embeddings,
    };
    let db = app.state::<DbState>();
    let info = {
        let db = db.lock().map_err(|e| e.to_string())?;
        db.save_song_fingerprint(&fp).map_err(|e| e.to_string())?;
        db.song_fingerprint_info(Some(&song_id)).map_err(|e| e.to_string())?
    };
    reload(&runtime, &db)?;
    changed(&app);
    info.into_iter().find(|i| i.id == fp.id).ok_or_else(|| "Fingerprint was not saved.".into())
}

#[tauri::command]
pub fn list_song_fingerprints(db: State<'_, DbState>, song_id: Option<String>) -> Result<Vec<SongFingerprintInfo>, String> {
    db.lock().map_err(|e| e.to_string())?.song_fingerprint_info(song_id.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_song_fingerprint(
    app: AppHandle,
    runtime: State<'_, SongDetectionRuntime>,
    db: State<'_, DbState>,
    id: String,
) -> Result<(), String> {
    db.lock().map_err(|e| e.to_string())?.delete_song_fingerprints(&[id]).map_err(|e| e.to_string())?;
    reload(&runtime, &db)?;
    changed(&app);
    Ok(())
}

/// After songs are deleted (their fingerprints go with them).
pub fn songs_changed(app: &AppHandle) {
    let runtime = app.state::<SongDetectionRuntime>();
    if let Err(e) = reload(&runtime, &app.state::<DbState>()) {
        log::warn!("[SONG] reload after song change failed: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fp(id: &str, source: &str, dim: usize) -> SongFingerprint {
        SongFingerprint {
            id: id.into(),
            song_id: "oceans".into(),
            source: source.into(),
            model: MODEL_ID.into(),
            embeddings: vec![vec![0.1; dim]],
        }
    }

    #[test]
    fn library_skips_bad_fingerprints() {
        let lib = library_from(vec![
            fp("ok", "operator", EMBED_DIM),
            fp("live", "live", EMBED_DIM),
            fp("short", "operator", 3),
            fp("odd", "guess", EMBED_DIM),
        ]);
        let ids: Vec<&str> = lib.references().iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids, ["ok", "live"]);
        assert_eq!(lib.references()[1].source, Source::Live);
    }

    #[test]
    fn stored_form_round_trips_the_source() {
        for s in [Source::Library, Source::Operator, Source::Live] {
            assert_eq!(source_of(source_name(s)), Some(s));
        }
        let r = Reference { id: "x".into(), song_id: "y".into(), source: Source::Live, embeddings: vec![vec![1.0]] };
        let stored = to_stored(&r);
        assert_eq!((stored.source.as_str(), stored.model.as_str()), ("live", MODEL_ID));
    }
}
