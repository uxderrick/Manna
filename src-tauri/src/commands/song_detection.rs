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
//! - a worker thread runs the sound matcher; while the operator has the
//!   detections panel switched to songs, final transcripts are also matched
//!   against every song's lyrics ([`on_transcript`]). Both emit
//!   [`EVENT_SONG_MATCHES`] with the best candidates.
//!
//! In songs mode a singing gate ([`SongDetectionRuntime::gate_for_speech`])
//! sits between the microphone and speech recognition: only singing and
//! music get through, talk is replaced with silence.
//!
//! The models (CLEWS `clews_int8.onnx`, about 208 MB; `YAMNet`
//! `yamnet.onnx`, 16 MB, for the gate) are not bundled yet. They are looked
//! for in the app data folder, then the resources, then (in development)
//! the checkout, under `models/songmatch/`.
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
use rhema_songmatch::gate::{GateConfig, SingingGate, SoundClassifier};
use rhema_songmatch::library::{Library, Reference, Source};
use rhema_songmatch::listener::{Learned, ListenerConfig, Matcher, Update};
use rhema_songmatch::lyrics::{LyricsConfig, LyricsIndex, SongLyrics, TranscriptWindow};
use rhema_songmatch::policy::{Candidate, Decision, PolicyConfig};
use rhema_songmatch::{EMBED_DIM, SAMPLE_RATE_HZ};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

/// Fingerprints made by another model are ignored, never compared.
pub const MODEL_ID: &str = "clews-dvi-int8-v1";
const MODEL_RELATIVE: &str = "models/songmatch/clews_int8.onnx";
/// The singing gate's sound classifier.
const GATE_MODEL_RELATIVE: &str = "models/songmatch/yamnet.onnx";
/// Intra-op threads for the model; leaves room for speech recognition.
const MODEL_THREADS: usize = 2;
/// About 50 s of 1024-sample frames: plenty while a check runs.
const QUEUE_FRAMES: usize = 800;
/// Shortest recording worth enrolling, in seconds.
const MIN_ENROL_S: f32 = 10.0;

pub const EVENT_SONG_MATCHES: &str = "song_matches";
/// Transcript words kept for lyrics matching (about two sung lines).
const LYRICS_WINDOW_WORDS: usize = 24;
pub const EVENT_SONG_FINGERPRINTS_CHANGED: &str = "song_fingerprints_changed";
/// No singing for [`IDLE_AFTER`]: the panel puts its matches aside as "earlier".
pub const EVENT_SONG_IDLE: &str = "song_matches_idle";
/// Quiet (no singing) this long ends a song: the lyrics window is cleared so
/// the next song starts fresh, and the panel is told.
const IDLE_AFTER: std::time::Duration = std::time::Duration::from_secs(30);

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
pub struct SongDetectionRuntime {
    listening: AtomicBool,
    engine: Mutex<Option<Engine>>,
    /// The operator switched detections to songs.
    songs_mode: AtomicBool,
    lyrics: Mutex<Option<LyricsIndex>>,
    window: Mutex<TranscriptWindow>,
    /// Lets only singing and music through to speech recognition in songs
    /// mode (`None` when its model is missing: everything goes through).
    gate: Mutex<Option<SingingGate>>,
    idle: Mutex<Idle>,
}

/// When singing (or, without the gate, any transcript) was last heard.
#[derive(Default)]
struct Idle {
    last_heard: Option<std::time::Instant>,
    /// The panel was told; wait for singing before telling it again.
    told: bool,
}

impl Default for SongDetectionRuntime {
    fn default() -> Self {
        Self {
            listening: AtomicBool::new(false),
            engine: Mutex::new(None),
            songs_mode: AtomicBool::new(false),
            lyrics: Mutex::new(None),
            window: Mutex::new(TranscriptWindow::new(LYRICS_WINDOW_WORDS)),
            gate: Mutex::new(None),
            idle: Mutex::new(Idle::default()),
        }
    }
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

    /// The audio speech recognition should hear. Outside songs mode, or
    /// without the gate's model, that is `pcm` unchanged. In songs mode,
    /// talk and noise are replaced with silence and the audio runs about a
    /// second behind (so the gate can open just before a line starts).
    /// Called from the capture thread for every frame.
    pub fn gate_for_speech(&self, app: &AppHandle, pcm: Vec<i16>) -> Vec<i16> {
        if !self.songs_mode.load(Ordering::Relaxed) {
            return pcm;
        }
        let Ok(mut guard) = self.gate.lock() else { return pcm };
        let Some(gate) = guard.as_mut() else { return pcm };
        let was_open = gate.is_open();
        let out = gate.push(&pcm);
        let open = gate.is_open();
        drop(guard);
        if open != was_open {
            log::info!("[SONG] singing gate {}", if open { "open" } else { "closed" });
        }
        if open {
            self.heard();
        } else if self.quiet_for(IDLE_AFTER) {
            self.put_aside(app);
        }
        out
    }

    fn heard(&self) {
        if let Ok(mut idle) = self.idle.lock() {
            idle.last_heard = Some(std::time::Instant::now());
            idle.told = false;
        }
    }

    /// Whether singing was heard, then nothing for `quiet`, and the panel
    /// has not been told yet.
    fn quiet_for(&self, quiet: std::time::Duration) -> bool {
        self.idle.lock().is_ok_and(|idle| !idle.told && idle.last_heard.is_some_and(|t| t.elapsed() >= quiet))
    }

    /// The song is over: forget its words and tell the panel.
    fn put_aside(&self, app: &AppHandle) {
        if let Ok(mut idle) = self.idle.lock() {
            idle.told = true;
        }
        if let Ok(mut window) = self.window.lock() {
            window.clear();
        }
        log::info!("[SONG] no singing for {} s: matches put aside", IDLE_AFTER.as_secs());
        let _ = app.emit(EVENT_SONG_IDLE, ());
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

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SongMatchItem {
    pub song_id: String,
    /// 0 to 1. Lyrics: share of the sung phrases found in the song. Sound:
    /// the lead in cohort units, scaled so the commit margin is about 0.5.
    pub score: f32,
    /// Lyrics only: the stanza being sung (stanzas in order, chorus last).
    pub stanza: Option<usize>,
    /// Lyrics only: the line most like what was heard.
    pub line: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SongMatchesPayload {
    /// `lyrics` or `sound`.
    pub source: &'static str,
    /// Best first; empty means nothing matches (clear the list).
    pub matches: Vec<SongMatchItem>,
    /// The first match is confident enough to present.
    pub confident: bool,
}

fn sound_score(c: &Candidate) -> f32 {
    (c.z / (2.0 * PolicyConfig::default().margin)).clamp(0.0, 1.0)
}

fn sound_payload(update: &Update) -> SongMatchesPayload {
    let item = |c: &Candidate| SongMatchItem { song_id: c.song_id.clone(), score: sound_score(c), stanza: None, line: None };
    let (matches, confident) = match &update.decision {
        Decision::Listening => (Vec::new(), false),
        Decision::Suggest { candidates } => (candidates.iter().map(item).collect(), false),
        Decision::Commit { candidate } => (vec![item(candidate)], true),
    };
    SongMatchesPayload { source: "sound", matches, confident }
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

fn model_candidates(app: &AppHandle, relative: &str) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(dir) = app.path().app_data_dir() {
        out.push(dir.join(relative));
    }
    if let Ok(dir) = app.path().resource_dir() {
        out.push(dir.join(relative));
    }
    if cfg!(debug_assertions) {
        out.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join(relative));
    }
    out
}

fn model_path(app: &AppHandle, relative: &str) -> Option<PathBuf> {
    model_candidates(app, relative).into_iter().find(|p| p.is_file())
}

#[cfg(any(feature = "onnx", feature = "songmatch-dynamic"))]
fn load_embedder(path: &std::path::Path) -> Result<Arc<dyn Embedder>, String> {
    rhema_songmatch::embedder::OnnxEmbedder::load(path, MODEL_THREADS)
        .map(|e| Arc::new(e) as Arc<dyn Embedder>)
        .map_err(|e| format!("Could not load the song detection model: {e}"))
}

#[cfg(not(any(feature = "onnx", feature = "songmatch-dynamic")))]
fn load_embedder(_path: &std::path::Path) -> Result<Arc<dyn Embedder>, String> {
    let _ = MODEL_THREADS;
    Err("Song detection is not included in this build.".into())
}

#[cfg(any(feature = "onnx", feature = "songmatch-dynamic"))]
fn load_classifier(path: &std::path::Path) -> Result<Box<dyn SoundClassifier>, String> {
    rhema_songmatch::gate::YamnetClassifier::load(path)
        .map(|c| Box::new(c) as Box<dyn SoundClassifier>)
        .map_err(|e| format!("Could not load the singing gate model: {e}"))
}

#[cfg(not(any(feature = "onnx", feature = "songmatch-dynamic")))]
fn load_classifier(_path: &std::path::Path) -> Result<Box<dyn SoundClassifier>, String> {
    Err("The singing gate is not included in this build.".into())
}

/// Load the singing gate once, and start it fresh. Without its model,
/// songs mode still works; speech recognition just hears everything.
async fn ensure_gate(app: &AppHandle) -> Result<(), String> {
    let runtime = app.state::<SongDetectionRuntime>();
    if let Some(gate) = runtime.gate.lock().map_err(|e| e.to_string())?.as_mut() {
        gate.reset();
        return Ok(());
    }
    let path = model_path(app, GATE_MODEL_RELATIVE)
        .ok_or_else(|| format!("The singing gate model is not installed ({GATE_MODEL_RELATIVE})."))?;
    let classifier = tauri::async_runtime::spawn_blocking(move || load_classifier(&path)).await.map_err(|e| e.to_string())??;
    *runtime.gate.lock().map_err(|e| e.to_string())? = Some(SingingGate::new(classifier, GateConfig::default()));
    log::info!("[SONG] singing gate ready");
    Ok(())
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
                    let _ = app.emit(EVENT_SONG_MATCHES, sound_payload(&update));
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
    let path = model_path(app, MODEL_RELATIVE).ok_or_else(|| {
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
        supported: cfg!(any(feature = "onnx", feature = "songmatch-dynamic")),
        model_path: model_path(&app, MODEL_RELATIVE).map(|p| p.display().to_string()),
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
    let db = app.state::<DbState>();
    if let Err(e) = reload(&runtime, &db) {
        log::warn!("[SONG] reload after song change failed: {e}");
    }
    if runtime.songs_mode.load(Ordering::Relaxed) {
        match (build_lyrics(&db), runtime.lyrics.lock()) {
            (Ok(index), Ok(mut slot)) => *slot = Some(index),
            (Err(e), _) => log::warn!("[SONG] lyrics rebuild failed: {e}"),
            (_, Err(e)) => log::warn!("[SONG] lyrics rebuild failed: {e}"),
        }
    }
}

// ── Songs mode (lyrics + sound) ─────────────────────────────────────

/// A song's lyrics from its stored JSON (`stanzas`, then `chorus` last).
pub fn lyrics_of(id: String, title: String, data: &str) -> Option<SongLyrics> {
    let v: serde_json::Value = serde_json::from_str(data).ok()?;
    let lines = |s: &serde_json::Value| -> Option<Vec<String>> {
        let l: Vec<String> = s.get("lines")?.as_array()?.iter().filter_map(|x| x.as_str().map(String::from)).collect();
        (!l.is_empty()).then_some(l)
    };
    let mut stanzas: Vec<Vec<String>> = v.get("stanzas")?.as_array()?.iter().filter_map(lines).collect();
    if let Some(chorus) = v.get("chorus").and_then(lines) {
        stanzas.push(chorus);
    }
    (!stanzas.is_empty()).then_some(SongLyrics { song_id: id, title, stanzas, preferred: false })
}

/// Songs bundled with Manna; everything else is the church's own.
const BUNDLED_HYMNALS: [&str; 4] = ["ghs", "mhb", "sankey", "sda"];

fn build_lyrics(db: &DbState) -> Result<LyricsIndex, String> {
    let rows = db.lock().map_err(|e| e.to_string())?.list_songs().map_err(|e| e.to_string())?;
    let songs = rows
        .into_iter()
        .filter_map(|r| {
            let own = !BUNDLED_HYMNALS.contains(&r.1.as_str());
            lyrics_of(r.0, r.3, &r.5).map(|l| SongLyrics { preferred: own, ..l })
        })
        .collect();
    Ok(LyricsIndex::new(songs, LyricsConfig::default()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SongModeStatus {
    pub enabled: bool,
    /// Songs with lyrics being matched against the transcript.
    pub lyrics_songs: usize,
    /// Sound matching is running.
    pub sound: bool,
    /// Why sound matching is off (no model, not in this build, ...).
    pub sound_note: Option<String>,
    /// Songs with a recording (sound fingerprint).
    pub sound_songs: usize,
    /// Only singing and music reach speech recognition.
    pub gate: bool,
    /// Why the singing gate is off.
    pub gate_note: Option<String>,
}

/// Whether songs mode is on. Verse detection pauses while it is.
pub fn songs_mode(app: &AppHandle) -> bool {
    app.state::<SongDetectionRuntime>().songs_mode.load(Ordering::Relaxed)
}

/// Tell offline speech whether people are singing (keeps sung lines).
fn set_singing(enabled: bool) {
    #[cfg(feature = "whisper")]
    rhema_stt::whisper::set_singing(enabled);
    #[cfg(not(feature = "whisper"))]
    let _ = enabled;
}

/// The operator switched the detections panel to songs (or back). Lyrics
/// matching always works; sound matching needs the model.
#[tauri::command]
pub async fn set_song_mode(app: AppHandle, enabled: bool) -> Result<SongModeStatus, String> {
    let runtime = app.state::<SongDetectionRuntime>();
    let db = app.state::<DbState>();
    set_singing(enabled);
    if !enabled {
        runtime.songs_mode.store(false, Ordering::Relaxed);
        runtime.listening.store(false, Ordering::Relaxed);
        runtime.send(Msg::Reset);
        *runtime.lyrics.lock().map_err(|e| e.to_string())? = None;
        return Ok(SongModeStatus {
            enabled,
            lyrics_songs: 0,
            sound: false,
            sound_note: None,
            sound_songs: 0,
            gate: false,
            gate_note: None,
        });
    }
    let index = build_lyrics(&db)?;
    let lyrics_songs = index.len();
    *runtime.lyrics.lock().map_err(|e| e.to_string())? = Some(index);
    runtime.window.lock().map_err(|e| e.to_string())?.clear();
    *runtime.idle.lock().map_err(|e| e.to_string())? = Idle::default();
    // The gate is ready (or known missing) before songs mode routes audio through it.
    let gate = ensure_gate(&app).await;
    if let Err(e) = &gate {
        log::warn!("[SONG] {e}");
    }
    runtime.songs_mode.store(true, Ordering::Relaxed);

    let sound = ensure_engine(&app).await;
    if sound.is_ok() {
        runtime.listening.store(true, Ordering::Relaxed);
        runtime.send(Msg::Reset);
    }
    let sound_songs = load_library(&db).map(|l| l.songs().len()).unwrap_or(0);
    log::info!(
        "[SONG] songs mode on: {lyrics_songs} songs by lyrics, sound {}, singing gate {}",
        if sound.is_ok() { "on" } else { "off" },
        if gate.is_ok() { "on" } else { "off" }
    );
    Ok(SongModeStatus {
        enabled,
        lyrics_songs,
        sound: sound.is_ok(),
        sound_note: sound.err(),
        sound_songs,
        gate: gate.is_ok(),
        gate_note: gate.err(),
    })
}

/// A final transcript segment: in songs mode, match it (with the previous
/// few) against every song's lyrics.
pub fn on_transcript(app: &AppHandle, transcript: &str) {
    let runtime = app.state::<SongDetectionRuntime>();
    if !runtime.songs_mode.load(Ordering::Relaxed) {
        return;
    }
    // Without the singing gate, a long gap between transcripts ends the song.
    let gated = runtime.gate.lock().is_ok_and(|g| g.is_some());
    if !gated {
        if runtime.quiet_for(IDLE_AFTER) {
            runtime.put_aside(app);
        }
        runtime.heard();
    }
    let Some(payload) = lyrics_payload(&runtime, transcript) else { return };
    let _ = app.emit(EVENT_SONG_MATCHES, payload);
}

fn lyrics_payload(runtime: &SongDetectionRuntime, transcript: &str) -> Option<SongMatchesPayload> {
    let text = runtime.window.lock().ok()?.push(transcript);
    let guard = runtime.lyrics.lock().ok()?;
    let result = guard.as_ref()?.search(&text);
    if let Some(top) = result.matches.first() {
        log::info!(
            "[SONG] lyrics: \"{}\" {:.0}%{} (heard \"{text}\", line \"{}\")",
            top.title,
            top.score * 100.0,
            if result.confident { " likely" } else { "" },
            top.line
        );
    }
    let matches = result
        .matches
        .into_iter()
        .map(|m| SongMatchItem { song_id: m.song_id, score: m.score, stanza: Some(m.stanza), line: Some(m.line) })
        .collect();
    Some(SongMatchesPayload { source: "lyrics", matches, confident: result.confident })
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

    #[test]
    fn lyrics_come_from_stored_song_json() {
        let data = r#"{"stanzas":[{"id":"1","kind":"verse","lines":["Amazing grace how sweet the sound","That saved a wretch like me"]},{"id":"2","kind":"verse","lines":[]}],"chorus":{"id":"c","kind":"chorus","lines":["Chorus line"]},"autoChorus":true}"#;
        let l = lyrics_of("ag".into(), "Amazing Grace".into(), data).unwrap();
        assert_eq!(l.stanzas.len(), 2, "empty stanza dropped, chorus last");
        assert_eq!(l.stanzas[1], ["Chorus line"]);
        assert!(lyrics_of("x".into(), "X".into(), "not json").is_none());
        assert!(lyrics_of("x".into(), "X".into(), r#"{"stanzas":[],"chorus":null}"#).is_none());
    }

    #[test]
    fn transcripts_are_matched_only_with_an_index() {
        let runtime = SongDetectionRuntime::default();
        assert!(lyrics_payload(&runtime, "amazing grace how sweet the sound").is_none());
        let song = lyrics_of(
            "ag".into(),
            "Amazing Grace".into(),
            r#"{"stanzas":[{"lines":["Amazing grace how sweet the sound","That saved a wretch like me"]}]}"#,
        )
        .unwrap();
        *runtime.lyrics.lock().unwrap() = Some(LyricsIndex::new(vec![song], LyricsConfig::default()));
        let p = lyrics_payload(&runtime, "amazing grace how sweet").unwrap();
        assert_eq!(p.source, "lyrics");
        assert_eq!(p.matches[0].song_id, "ag");
        let p = lyrics_payload(&runtime, "the sound that saved a wretch like me").unwrap();
        assert!(p.confident, "two lines heard across segments");
    }

    #[test]
    fn sound_decisions_become_matches() {
        let c = Candidate { song_id: "s".into(), z: 2.5, similarity: 0.3, in_plan: true };
        let u = Update { heard_s: 8.0, decision: Decision::Commit { candidate: c }, new_commit: true };
        let p = sound_payload(&u);
        assert!(p.confident);
        assert!((p.matches[0].score - 0.5).abs() < 1e-6);
        let quiet = Update { heard_s: 0.0, decision: Decision::Listening, new_commit: false };
        assert!(sound_payload(&quiet).matches.is_empty());
    }
}
