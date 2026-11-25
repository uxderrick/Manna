//! Audio capture and fan-out stay on one thread because cpal's stream is not Send.
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use rhema_audio::{AudioConfig, AudioFrame};
use tauri::{AppHandle, Emitter, Manager, State};

use super::recorded_segment::RecordedSegment;
use crate::events::{AudioLevelPayload, EVENT_AUDIO_LEVEL};

pub(super) async fn wait_until_ready(
    ready: tokio::sync::oneshot::Receiver<Result<(), String>>,
    stt_active: &AtomicBool,
    audio_active: &AtomicBool,
) -> Result<(), String> {
    let result = match tokio::time::timeout(std::time::Duration::from_secs(15), ready).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("Microphone startup stopped unexpectedly. Try starting again.".into()),
        Err(_) => {
            Err("Microphone startup timed out. Check the input device in Settings → Audio.".into())
        }
    };
    if result.is_err() {
        stt_active.store(false, Ordering::SeqCst);
        audio_active.store(false, Ordering::SeqCst);
    }
    result
}

fn capture_failed(error: &str, stt_active: &AtomicBool, audio_active: &AtomicBool) -> String {
    stt_active.store(false, Ordering::SeqCst);
    audio_active.store(false, Ordering::SeqCst);
    format!("Microphone input stopped. Reconnect the microphone or choose an input in Settings → Audio, then click Start to resume. {error}")
}

#[cfg(test)]
mod startup_tests {
    use super::*;

    #[tokio::test]
    async fn unavailable_microphone_fails_start_and_clears_active_flags() {
        let stt = AtomicBool::new(true);
        let audio = AtomicBool::new(true);
        let (tx, rx) = tokio::sync::oneshot::channel();
        tx.send(Err("Microphone unavailable".to_owned())).unwrap();
        let result = wait_until_ready(rx, &stt, &audio).await;
        assert_eq!(result, Err("Microphone unavailable".to_owned()));
        assert!(!stt.load(Ordering::SeqCst));
        assert!(!audio.load(Ordering::SeqCst));
    }

    #[test]
    fn runtime_device_loss_stops_the_run_and_offers_a_restart() {
        let stt = AtomicBool::new(true);
        let audio = AtomicBool::new(true);
        let message = capture_failed("device unplugged", &stt, &audio);
        assert!(!stt.load(Ordering::SeqCst));
        assert!(!audio.load(Ordering::SeqCst));
        assert!(message.contains("Start"));
        assert!(message.contains("device unplugged"));
    }

    #[tokio::test]
    async fn start_waits_for_capture_confirmation() {
        let stt = AtomicBool::new(true);
        let audio = AtomicBool::new(true);
        let (tx, rx) = tokio::sync::oneshot::channel();
        let ready = wait_until_ready(rx, &stt, &audio);
        tokio::pin!(ready);
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(20), &mut ready)
                .await
                .is_err()
        );
        tx.send(Ok(())).unwrap();
        assert_eq!(ready.await, Ok(()));
        assert!(stt.load(Ordering::SeqCst));
        assert!(audio.load(Ordering::SeqCst));
    }
}

pub(super) struct CaptureConfig {
    pub app: AppHandle,
    pub active: Arc<AtomicBool>,
    pub audio_active: Arc<AtomicBool>,
    pub recording_paused: Arc<AtomicBool>,
    pub device_id: Option<String>,
    pub gain: f32,
    pub session_dir: Option<std::path::PathBuf>,
    pub session_id: Option<i64>,
    pub audio_send_tx: crossbeam_channel::Sender<Vec<i16>>,
    pub ready_tx: tokio::sync::oneshot::Sender<Result<(), String>>,
}

pub(super) fn spawn(config: CaptureConfig) -> std::io::Result<std::thread::JoinHandle<()>> {
    let CaptureConfig {
        app: fan_app,
        active: fan_active,
        audio_active,
        recording_paused,
        device_id,
        gain: gain_val,
        session_dir,
        session_id,
        audio_send_tx,
        ready_tx,
    } = config;
    std::thread::Builder::new()
        .name("audio-fanout".into())
        .spawn(move || {
            let config = AudioConfig {
                device_id,
                sample_rate: 16_000,
                gain: gain_val,
            };

            let (audio_tx, audio_rx) = crossbeam_channel::bounded::<AudioFrame>(64);

            // Mint a fresh, chronologically-sortable segment path inside the
            // session dir. Returns None if recording is disabled.
            let new_segment = || -> Option<std::path::PathBuf> {
                let dir = session_dir.as_ref()?;
                let millis = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis())
                    .unwrap_or(0);
                // 13-digit, zero-padded so lexicographic sort == chronological.
                Some(dir.join(format!("audio-seg-{millis:013}.mp3")))
            };

            // Open the first MP3 segment if recording is enabled. Failures are
            // logged and recording is silently disabled — the transcript
            // pipeline must keep working even if disk is full or LAME init fails.
            let open_segment = || -> Option<RecordedSegment> {
                let path = new_segment()?;
                match RecordedSegment::create(&path, 16_000) {
                    Ok(w) => {
                        log::info!("[REC] recording to {}", path.display());
                        Some(w)
                    }
                    Err(e) => {
                        log::error!("[REC] Mp3Writer::create({}) failed: {e}", path.display());
                        None
                    }
                }
            };

            let mut mp3: Option<RecordedSegment> = if recording_paused.load(Ordering::SeqCst) {
                None
            } else {
                let w = open_segment();
                // If recording was requested but the first segment failed to
                // open, clear the eager audio_path so playback doesn't surface a
                // broken link.
                if w.is_none() && session_dir.is_some() {
                    if let Some(sid) = session_id {
                        let db_state: State<'_, Mutex<rhema_notes::SessionDb>> = fan_app.state();
                        if let Ok(db) = db_state.lock() {
                            let _ = db.clear_session_audio_path(sid);
                        };
                    }
                }
                w
            };

            let song_detection: State<'_, crate::commands::song_detection::SongDetectionRuntime> = fan_app.state();

            // Start capture on THIS thread — AudioCapture stays here.
            let capture = match rhema_audio::capture::start(config, audio_tx) {
                Ok(c) => c,
                Err(e) => {
                    log::error!("Failed to start audio capture: {e}");
                    fan_active.store(false, Ordering::SeqCst);
                    let _ = ready_tx.send(Err(format!(
                        "Could not open the microphone. Check the input device in Settings → Audio. {e}"
                    )));
                    return;
                }
            };

            log::info!("Audio capture started on fanout thread");
            // A stream can open without delivering callbacks. Wait for a real
            // frame before allowing the speech connection to start.
            let mut ready_tx = Some(ready_tx);

            let mut frame_count: u64 = 0;

            loop {
                if !fan_active.load(Ordering::SeqCst) {
                    break;
                }

                if let Some(error) = capture.take_error() {
                    let message = capture_failed(&error, &fan_active, &audio_active);
                    if let Some(ready) = ready_tx.take() {
                        let _ = ready.send(Err(message.clone()));
                    }
                    let _ = fan_app.emit("stt_error", message);
                    break;
                }

                // Handle pause/resume transitions for recording (transcription
                // continues regardless). Paused → finalize current segment;
                // resumed → open a fresh segment. The paused interval is simply
                // absent from the recording.
                let paused = recording_paused.load(Ordering::SeqCst);
                if paused && mp3.is_some() {
                    if let Some(writer) = mp3.take() {
                        match writer.finalize() {
                            Ok(()) => log::info!("[REC] paused — segment finalized"),
                            Err(e) => log::error!("[REC] finalize on pause failed: {e}"),
                        }
                    }
                } else if !paused && mp3.is_none() && session_dir.is_some() {
                    mp3 = open_segment();
                }

                match audio_rx.recv_timeout(std::time::Duration::from_millis(100)) {
                    Ok(frame) => {
                        if let Some(ready) = ready_tx.take() {
                            let _ = ready.send(Ok(()));
                        }
                        frame_count += 1;

                        // (a) Compute audio levels at ~15 Hz
                        //     At 16 kHz with ~1024-sample frames, every 4th frame is ~15 Hz.
                        if frame_count % 4 == 0 {
                            let level = rhema_audio::meter::compute_level(&frame.samples);
                            let _ = fan_app.emit(
                                EVENT_AUDIO_LEVEL,
                                AudioLevelPayload {
                                    rms: level.rms,
                                    peak: level.peak,
                                },
                            );
                        }

                        // Write to MP3 first (uses &frame.samples) before moving samples into STT
                        // channel, to avoid a clone.
                        if mp3.is_some() {
                            // Use `as_mut` to encode, then take + finalize on error so LAME's
                            // trailing frames are flushed instead of dropped by `Mp3Writer`'s Drop.
                            let encode_err = mp3
                                .as_mut()
                                .and_then(|writer| writer.write_frame(&frame).err());
                            if let Some(e) = encode_err {
                                log::error!("[REC] write_samples failed: {e}; disabling recording");
                                if let Some(writer) = mp3.take() {
                                    if let Err(fe) = writer.finalize() {
                                        log::error!("[REC] finalize after write error: {fe}");
                                    }
                                }
                            }
                        }

                        // (b) Song detection (drops the frame if it is not listening)
                        song_detection.feed(&frame.samples);

                        // (c) Forward audio to the STT provider (in songs mode,
                        // only singing and music: talk is silenced)
                        let samples = song_detection.gate_for_speech(&fan_app, frame.samples);
                        if !samples.is_empty() {
                            let _ = audio_send_tx.try_send(samples);
                        }
                    }
                    Err(crossbeam_channel::RecvTimeoutError::Timeout) => {}
                    Err(crossbeam_channel::RecvTimeoutError::Disconnected) => {
                        let message = capture_failed("Audio input closed.", &fan_active, &audio_active);
                        if let Some(ready) = ready_tx.take() {
                            let _ = ready.send(Err(message.clone()));
                        }
                        let _ = fan_app.emit("stt_error", message);
                        break;
                    },
                }
            }

            let had_recording = mp3.is_some();
            if let Some(writer) = mp3.take() {
                match writer.finalize() {
                    Ok(()) => log::info!("[REC] MP3 finalized"),
                    Err(e) => log::error!("[REC] MP3 finalize failed: {e}"),
                }
            }
            // Signal that this segment is fully flushed/closed so the frontend's
            // finalize step can safely concatenate without racing the writer.
            if had_recording {
                let _ = fan_app.emit("recording_segment_finalized", ());
            }

            // Dropping `capture` stops the cpal stream.
            capture.stop();
            audio_active.store(false, Ordering::SeqCst);
            log::info!("Audio capture stopped on fanout thread");
        })
}
