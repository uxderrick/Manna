#![expect(
    clippy::needless_pass_by_value,
    reason = "Tauri command extractors require pass-by-value"
)]

mod capture;
mod direct;
mod lifecycle;
pub mod local;
mod quotation;
mod reading;
mod recorded_segment;
mod semantic;
mod translation;
mod verification;

use direct::run_direct_detection;
use quotation::run_quotation_matching;
use reading::check_reading_mode;
use semantic::run_semantic_detection;
use translation::check_translation_command;
pub use verification::VerifyResult;

use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, Manager, State};

use crate::events::{TranscriptPayload, EVENT_TRANSCRIPT_FINAL, EVENT_TRANSCRIPT_PARTIAL};
use crate::state::AppState;
use rhema_stt::{DeepgramClient, SttConfig, SttProvider, TranscriptEvent};

/// Prepare a short-lived TLS connection; never starts audio or authenticates a session.
#[tauri::command]
pub async fn prepare_stt_connection(provider: String) -> Result<bool, String> {
    rhema_stt::connection_warmup::prepare(&provider)
        .await
        .map_err(|e| e.to_string())
}

/// Start the full audio-capture-to-transcription pipeline.
///
/// 1. Opens the microphone via cpal (on a dedicated thread so the non-Send
///    `AudioCapture` never crosses thread boundaries).
/// 2. Connects to the selected STT provider (Deepgram cloud or Whisper local).
/// 3. Fans audio out to both the level meter (emits `audio_level` events) and STT.
/// 4. Receives transcripts and emits `transcript_partial` / `transcript_final` events.
/// 5. On final transcripts, runs the detection pipeline and emits `verse_detected` events.
#[expect(
    clippy::too_many_lines,
    reason = "pipeline setup is inherently complex"
)]
#[expect(
    clippy::too_many_arguments,
    reason = "Tauri command surface intentionally exposes all start options"
)]
#[tauri::command]
pub async fn start_transcription(
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
    api_key: String,
    device_id: Option<String>,
    gain: Option<f32>,
    provider: Option<String>,
    session_id: Option<i64>,
    record_audio: Option<bool>,
) -> Result<(), String> {
    // ── 1. Guard: already running? ──────────────────────────────────────
    // Idempotent: if already running, return Ok. The frontend may call Start
    // after a perceived disconnect (e.g. Deepgram silence-close) while the
    // backend is still happily reconnecting — rejecting with an error strands
    // the user. A no-op start keeps UI and backend in sync.
    {
        let app_state = state.lock().map_err(|e| e.to_string())?;
        if app_state.stt_stopping {
            return Err("Transcription is still stopping. Try again when it finishes.".into());
        }
        if app_state.stt_active.load(Ordering::Relaxed) {
            if app_state.transcription_session_id != session_id {
                return Err(
                    "Another session is using the microphone. End it before starting this session."
                        .into(),
                );
            }
            log::info!("start_transcription called but already running — no-op");
            let _ = app.emit("stt_connected", ());
            return Ok(());
        }
    }

    let provider_name = provider.as_deref().unwrap_or(local::get_default_stt_provider());

    // ── 2. Build the STT provider ───────────────────────────────────────
    let stt_provider: Arc<dyn SttProvider> = match provider_name {
        #[cfg(feature = "whisper")]
        "whisper" => {
            let model_path = local::model_path(&app)?;

            let parallelism = std::thread::available_parallelism().map_or(4, usize::from);
            let n_threads = i32::try_from(parallelism / 2).unwrap_or(2).max(1);

            log::info!(
                "Starting Whisper transcription: model={}, threads={n_threads}, device_id={device_id:?}",
                model_path.display()
            );

            Arc::new(rhema_stt::WhisperProvider::new(model_path, None, n_threads))
        }
        #[cfg(not(feature = "whisper"))]
        "whisper" => {
            return Err("Whisper support not compiled. Rebuild with --features whisper".into());
        }
        "assemblyai" => {
            let resolved_api_key = if api_key.is_empty() {
                std::env::var("ASSEMBLYAI_API_KEY").unwrap_or_default()
            } else {
                api_key
            };

            if resolved_api_key.is_empty() {
                return Err(
                    "No AssemblyAI API key provided. Set it in Settings or via ASSEMBLYAI_API_KEY env var."
                        .into(),
                );
            }

            log::info!("Starting AssemblyAI transcription: device_id={device_id:?}, gain={gain:?}");

            let stt_config = SttConfig {
                api_key: resolved_api_key,
                model: "universal-streaming".to_string(),
                sample_rate: 16_000,
                encoding: "pcm_s16le".to_string(),
                language: None,
            };

            Arc::new(rhema_stt::AssemblyAIClient::new(stt_config))
        }
        _ => {
            // Deepgram (default)
            let resolved_api_key = if api_key.is_empty() {
                std::env::var("DEEPGRAM_API_KEY").unwrap_or_default()
            } else {
                api_key
            };

            if resolved_api_key.is_empty() {
                return Err(
                    "No Deepgram API key provided. Set it in Settings or via DEEPGRAM_API_KEY env var."
                        .into(),
                );
            }

            log::info!("Starting Deepgram transcription: device_id={device_id:?}, gain={gain:?}");

            let stt_config = SttConfig {
                api_key: resolved_api_key,
                model: "nova-3".to_string(),
                sample_rate: 16_000,
                encoding: "linear16".to_string(),
                language: None,
            };

            Arc::new(DeepgramClient::new(stt_config))
        }
    };

    let (stt_active, audio_active) = {
        let mut app_state = state.lock().map_err(|e| e.to_string())?;
        if app_state.stt_stopping || app_state.stt_active.load(Ordering::SeqCst) {
            return Err("Transcription is already starting or stopping.".into());
        }
        if app_state
            .capture_thread
            .as_ref()
            .is_some_and(|thread| !thread.is_finished())
            || app_state
                .provider_task
                .as_ref()
                .is_some_and(|task| !task.inner().is_finished())
            || app_state
                .transcript_task
                .as_ref()
                .is_some_and(|task| !task.inner().is_finished())
        {
            return Err("The previous recording is still closing. Try again.".into());
        }
        app_state.transcription_session_id = session_id;
        app_state.stt_active = Arc::new(std::sync::atomic::AtomicBool::new(true));
        app_state.audio_active = Arc::new(std::sync::atomic::AtomicBool::new(true));
        app_state.stt_provider = Some(stt_provider.clone());
        (app_state.stt_active.clone(), app_state.audio_active.clone())
    };

    // ── 3. Prepare channels ─────────────────────────────────────────────
    let (audio_send_tx, audio_send_rx) = crossbeam_channel::bounded::<Vec<i16>>(64);

    // ── 4. Spawn the audio-capture + fan-out thread ─────────────────────
    // cpal's `Stream` (inside `AudioCapture`) is !Send, so we must create
    // and drop it on the same thread. This thread:
    //   a) starts the cpal capture
    //   b) reads AudioFrames
    //   c) computes levels → emits audio_level events
    //   d) forwards samples to STT provider via crossbeam
    let gain_val = gain.unwrap_or(1.0).clamp(0.0, 2.0);

    // Resolve the per-session recording directory. Recording is enabled by
    // default; disable per-call with `record_audio: Some(false)`. Without a
    // `session_id` we can't tie audio to a row, so skip silently.
    //
    // Audio is written as NEW segment files (`audio-seg-<millis>.mp3`), one per
    // start AND one per pause→resume cycle, never truncating a single file. A
    // reload/restart/crash or a mid-service pause therefore never overwrites
    // prior audio — segments accumulate and concatenate into the final
    // `audio.mp3` on End Session (or lazily when the session is next opened).
    let mut session_dir: Option<std::path::PathBuf> = None;
    if record_audio.unwrap_or(true) {
        if let Some(sid) = session_id {
            let db_state: State<'_, Mutex<rhema_notes::SessionDb>> = app.state();
            let audio_path = db_state.lock().ok()
                .and_then(|db| db.get_session(sid).ok())
                .and_then(|session| session.audio_path);
            let dir = crate::commands::storage::recording_dir(
                crate::commands::storage::session_dir(&app, sid), audio_path.as_deref());
            match std::fs::create_dir_all(&dir) {
                Ok(()) => session_dir = Some(dir),
                Err(e) => log::warn!(
                    "[REC] could not create {}: {e}; skipping recording",
                    dir.display()
                ),
            }
        } else {
            log::info!("[REC] recording requested but no session_id; skipping");
        }
    }

    // Eagerly point `audio_path` at the final concatenated file (even though it
    // doesn't exist until concat) so the session row reflects that audio is
    // being captured.
    if let (Some(dir), Some(sid)) = (&session_dir, session_id) {
        let final_path = dir.join("audio.mp3");
        let db_state: State<'_, Mutex<rhema_notes::SessionDb>> = app.state();
        match db_state.lock() {
            Ok(db) => {
                if let Err(e) = db.set_session_audio_path(sid, &final_path.to_string_lossy()) {
                    log::warn!("[REC] could not persist audio_path: {e}");
                }
            }
            Err(e) => log::warn!("[REC] DB lock unavailable for audio_path: {e}"),
        };
    }

    let (capture_ready_tx, capture_ready_rx) = tokio::sync::oneshot::channel();
    {
        let mut starting_state = state.lock().map_err(|e| e.to_string())?;
        if !stt_active.load(Ordering::SeqCst)
            || !Arc::ptr_eq(&starting_state.stt_active, &stt_active)
        {
            return Err("Transcription startup was cancelled.".into());
        }
        starting_state
            .recording_paused
            .store(false, Ordering::SeqCst);
        let recording_paused = starting_state.recording_paused.clone();
        let capture_thread = capture::spawn(capture::CaptureConfig {
            app: app.clone(),
            active: stt_active.clone(),
            audio_active: audio_active.clone(),
            recording_paused,
            device_id,
            gain: gain_val,
            session_dir,
            session_id,
            audio_send_tx,
            ready_tx: capture_ready_tx,
        })
        .map_err(|e| {
            stt_active.store(false, Ordering::SeqCst);
            audio_active.store(false, Ordering::SeqCst);
            format!("Failed to spawn audio fanout thread: {e}")
        })?;

        starting_state.capture_thread = Some(capture_thread);
    }
    // Do not open a speech session or report successful startup without audio.
    if let Err(error) =
        capture::wait_until_ready(capture_ready_rx, &stt_active, &audio_active).await
    {
        lifecycle::stop_current(&state, session_id, Some(&stt_active)).await?;
        return Err(error);
    }
    let mut running_state = state.lock().map_err(|e| e.to_string())?;
    if !stt_active.load(Ordering::SeqCst) || running_state.stt_stopping {
        return Err("Transcription startup was cancelled.".into());
    }

    // ── 5. Spawn the STT provider on the tokio runtime ──────────────────
    let (event_tx, mut event_rx) = tokio::sync::mpsc::channel::<TranscriptEvent>(64);

    let conn_active = stt_active.clone();
    let provider_log_name = stt_provider.name().to_string();

    // Task A: run the STT provider (Deepgram WS+REST or Whisper local).
    running_state.provider_task = Some(tauri::async_runtime::spawn(async move {
        let result = stt_provider.start(audio_send_rx, event_tx).await;
        if let Err(e) = result {
            log::error!("[STT-{provider_log_name}] Provider failed: {e}");
        }
        conn_active.store(false, Ordering::SeqCst);
        log::info!("[STT-{provider_log_name}] Provider task exited");
    }));

    // Task B: consume TranscriptEvents, emit to frontend, run detection
    let evt_active = stt_active.clone();
    let event_app = app.clone();

    // Background semantic detection channel — non-blocking, drops if busy
    let (semantic_tx, mut semantic_rx) = tokio::sync::mpsc::channel::<String>(4);

    // Spawn semantic detection worker (runs ONNX inference without blocking transcript)
    let sem_app = app.clone();
    let semantic_active = stt_active.clone();
    let semantic_worker = tauri::async_runtime::spawn(async move {
        while let Some(text) = semantic_rx.recv().await {
            if !semantic_active.load(Ordering::SeqCst) {
                break;
            }
            let worker_app = sem_app.clone();
            let worker_active = semantic_active.clone();
            if let Err(e) = tauri::async_runtime::spawn_blocking(move || {
                run_semantic_detection(&worker_app, &text, &worker_active)
            })
            .await
            {
                log::error!("Semantic worker failed: {e}");
            }
        }
    });

    // Background quotation matching channel — fast but separate thread
    let (quotation_tx, mut quotation_rx) = tokio::sync::mpsc::channel::<String>(8);

    let quot_app = app.clone();
    let quotation_active = stt_active.clone();
    let quotation_worker = tauri::async_runtime::spawn(async move {
        while let Some(text) = quotation_rx.recv().await {
            if !quotation_active.load(Ordering::SeqCst) {
                break;
            }
            run_quotation_matching(&quot_app, &text, &quotation_active);
        }
    });

    running_state.transcript_task = Some(tauri::async_runtime::spawn(async move {
        // Sentence buffer accumulates is_final fragments into complete sentences.
        // Flushes on sentence-ending punctuation or speech_final signal.
        let mut sentence_buf = rhema_detection::SentenceBuffer::new();

        while let Some(event) = event_rx.recv().await {
            match event {
                TranscriptEvent::Partial { transcript, .. } => {
                    if !transcript.is_empty() {
                        let _ = event_app.emit(
                            EVENT_TRANSCRIPT_PARTIAL,
                            TranscriptPayload {
                                text: transcript.clone(),
                                is_final: false,
                                confidence: 0.0,
                            },
                        );

                        // Run direct detection on partials too — cheap regex
                        // patterns make this feasible on every interim result.
                        // This makes detection feel instant for verbose forms
                        // like "Psalm chapter 2 verse 3" that take longer to
                        // finalize than compact "Psalm 2:3".
                        if !crate::commands::song_detection::songs_mode(&event_app) {
                            run_direct_detection(&event_app, &transcript);
                        }
                    }
                }
                TranscriptEvent::Final {
                    transcript,
                    confidence,
                    speech_final,
                    ..
                } => {
                    if !transcript.is_empty() {
                        // Emit as permanent transcript segment (every is_final)
                        let _ = event_app.emit(
                            EVENT_TRANSCRIPT_FINAL,
                            TranscriptPayload {
                                text: transcript.clone(),
                                is_final: true,
                                confidence,
                            },
                        );

                        // Songs mode: match the sung words against song lyrics
                        // instead of detecting verses.
                        if crate::commands::song_detection::songs_mode(&event_app) {
                            crate::commands::song_detection::on_transcript(&event_app, &transcript);
                            continue;
                        }

                        // Check for translation commands: "read in NIV", "switch to ESV"
                        check_translation_command(&event_app, &transcript);

                        // Direct detection: instant (regex), runs on every is_final
                        let direct_found = run_direct_detection(&event_app, &transcript);

                        // Reading mode: check if transcript matches expected verse
                        let reading_handled =
                            check_reading_mode(&event_app, &transcript, direct_found);

                        // Quotation matching: run on every is_final (fast, no ONNX)
                        if !direct_found && !reading_handled {
                            let _ = quotation_tx.try_send(transcript.clone());
                        }

                        // Only accumulate for semantic if neither direct nor
                        // reading mode handled it. No point running ONNX inference
                        // on "Revelation chapter two verse three" when direct
                        // already detected it at 100%.
                        if direct_found || reading_handled {
                            // Clear the sentence buffer — already handled
                            sentence_buf.force_flush();
                        } else if let Some(sentence) = sentence_buf.append(&transcript) {
                            let _ = semantic_tx.try_send(sentence);
                        }
                    }

                    // On speech_final: force-flush any remaining buffered text
                    if speech_final {
                        if let Some(sentence) = sentence_buf.force_flush() {
                            let _ = semantic_tx.try_send(sentence);
                        }
                    }
                }
                TranscriptEvent::UtteranceEnd => {
                    // Fallback: flush sentence buffer on utterance end
                    if let Some(sentence) = sentence_buf.force_flush() {
                        let _ = semantic_tx.try_send(sentence);
                    }
                }
                TranscriptEvent::SpeechStarted => {
                    let _ = event_app.emit("stt_speech_started", ());
                }
                TranscriptEvent::Error(msg) => {
                    log::error!("[STT] Error: {msg}");
                    let _ = event_app.emit("stt_error", msg);
                }
                TranscriptEvent::Connected => {
                    log::info!("[STT] Connected");
                    let _ = event_app.emit("stt_connected", ());
                }
                TranscriptEvent::Reconnecting => {
                    log::info!("[STT] Reconnecting");
                    let _ = event_app.emit("stt_reconnecting", ());
                }
                TranscriptEvent::Disconnected => {
                    log::warn!("[STT] Disconnected");
                    let _ = event_app.emit("stt_disconnected", ());
                }
            }
        }

        drop(semantic_tx);
        drop(quotation_tx);
        let _ = semantic_worker.await;
        let _ = quotation_worker.await;
        // Always notify frontend that transcription has stopped
        let _ = event_app.emit("stt_disconnected", ());
        evt_active.store(false, Ordering::SeqCst);
        log::info!("Transcript event consumer task exited");
    }));
    drop(running_state);

    Ok(())
}

/// Stop the transcription pipeline (audio capture + STT provider).
#[tauri::command]
pub async fn stop_transcription(
    state: State<'_, Mutex<AppState>>,
    session_id: Option<i64>,
) -> Result<(), String> {
    lifecycle::stop(&state, session_id).await
}

/// Whether the transcription/recording pipeline is currently running.
///
/// Used by the frontend on mount (e.g. after a webview reload) to decide
/// whether to re-attach to a still-running session instead of restarting it —
/// restarting would spawn a duplicate capture thread and a fresh audio segment.
#[tauri::command]
pub fn get_stt_status(state: State<'_, Mutex<AppState>>) -> Result<bool, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    Ok(app_state.stt_active.load(Ordering::Relaxed))
}

/// Pause or resume audio recording without stopping transcription. Paused
/// finalizes the current MP3 segment; resumed opens a fresh one. Segments
/// merge into one file on End Session.
#[tauri::command]
pub fn set_recording_paused(state: State<'_, Mutex<AppState>>, paused: bool) -> Result<(), String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    app_state.recording_paused.store(paused, Ordering::SeqCst);
    log::info!(
        "[REC] recording {}",
        if paused { "paused" } else { "resumed" }
    );
    Ok(())
}

/// Current recording pause state (for restoring the toggle after a reload).
#[tauri::command]
pub fn get_recording_paused(state: State<'_, Mutex<AppState>>) -> Result<bool, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    Ok(app_state.recording_paused.load(Ordering::Relaxed))
}

/// Verify the configured deepgram API key.
#[tauri::command]
pub async fn verify_deepgram_key(api_key: String) -> Result<VerifyResult, String> {
    verification::verify_deepgram_key(api_key).await
}

/// Verify the configured assemblyai API key.
#[tauri::command]
pub async fn verify_assemblyai_key(api_key: String) -> Result<VerifyResult, String> {
    verification::verify_assemblyai_key(api_key).await
}

/// Verify the configured claude API key.
#[tauri::command]
pub async fn verify_claude_key(api_key: String) -> Result<VerifyResult, String> {
    verification::verify_claude_key(api_key).await
}

/// Verify the configured deepseek API key.
#[tauri::command]
pub async fn verify_deepseek_key(api_key: String) -> Result<VerifyResult, String> {
    verification::verify_deepseek_key(api_key).await
}
