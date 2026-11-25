//! Local Whisper STT provider using whisper.cpp via whisper-rs.
//!
//! Processes audio through the app's VAD to detect speech boundaries,
//! then runs Whisper inference on each speech segment. Emits the same
//! [`TranscriptEvent`] types as the Deepgram provider.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use crossbeam_channel::Receiver;
use tokio::sync::mpsc;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters, WhisperState};

use crate::error::SttError;
use crate::provider::SttProvider;
use crate::types::{TranscriptEvent, Word};

/// Maximum audio buffer before force-flushing to inference (10 seconds at 16 kHz).
const MAX_BUFFER_SAMPLES: usize = 16_000 * 10;

/// Songs mode: Whisper is less sure of sung words than spoken ones (sung
/// lines scored 0.44-0.54, under the usual 0.55 bar) and wraps them in ♪.
static SINGING: AtomicBool = AtomicBool::new(false);

/// Confidence bar while singing. Junk on noise ("the", "and") scored 0.2-0.36.
const SINGING_MIN_CONFIDENCE: f64 = 0.40;

/// Switch songs mode: keep sung lines and strip Whisper's music marks.
pub fn set_singing(on: bool) {
    SINGING.store(on, Ordering::Relaxed);
}

/// The text without Whisper's music marks (♪ and friends).
fn strip_music_marks(text: &str) -> String {
    text.split_whitespace()
        .map(|w| w.trim_matches(|c| matches!(c, '♪' | '♫' | '♬' | '♩')))
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Samples per VAD frame (64 ms); `VadConfig`'s frame counts assume this.
const VAD_FRAME_SAMPLES: usize = 1024;

/// Minimum audio buffer for inference (1.0 seconds).
/// Whisper warns "input is too short" below 1s.
const MIN_BUFFER_SAMPLES: usize = 16_000;

/// Whether Whisper runs on the processor here. whisper.cpp uses the GPU only
/// on Apple silicon; Intel Macs fall back to the CPU, and other builds have no
/// GPU backend.
const CPU_ONLY: bool = !cfg!(all(target_os = "macos", target_arch = "aarch64"));

/// Encoder slices kept beyond the clip itself when the window is trimmed
/// (Whisper reads 50 slices per second of audio).
const TRIM_MARGIN_SLICES: usize = 256;

/// The encoder window for a clip, in slices. Whisper always pads audio to
/// 30 s (1,500 slices) and encodes all of it, which on a CPU costs 6–15 s even
/// for a 2 s clip. Encoding only the clip plus a margin is 3–4× faster; the
/// margin keeps some trailing silence, which tells the decoder the speech
/// ended (without it, it tends to repeat itself).
fn trimmed_audio_ctx(samples: usize) -> i32 {
    let slices = (samples.div_ceil(320) + TRIM_MARGIN_SLICES).min(1500);
    i32::try_from(slices).unwrap_or(1500)
}

/// A phrase repeated this many times in a row is a decoding loop.
const LOOP_REPEATS: usize = 3;

/// Shortest phrase checked for loops. Single words are left alone, so lyrics
/// such as "holy, holy, holy" survive.
const MIN_LOOP_WORDS: usize = 2;

/// Indices of the words to keep once phrases Whisper repeated in a loop are
/// cut back to one copy. A cut-off final copy at the end counts as a repeat.
fn loop_free(words: &[&str]) -> Vec<usize> {
    let norm: Vec<String> = words
        .iter()
        .map(|w| w.chars().filter(|c| c.is_alphanumeric()).collect::<String>().to_lowercase())
        .collect();
    let mut keep = vec![true; norm.len()];
    let mut i = 0;
    while i < norm.len() {
        let mut next = i + 1;
        for k in (MIN_LOOP_WORDS..=(norm.len() - i) / 2).rev() {
            let phrase = &norm[i..i + k];
            let mut end = i + k;
            let mut reps = 1;
            while end + k <= norm.len() && norm[end..end + k] == *phrase {
                end += k;
                reps += 1;
            }
            let tail = norm.len() - end;
            let partial = (2..k).contains(&tail) && norm[end..] == phrase[..tail];
            if reps + usize::from(partial) >= LOOP_REPEATS {
                let stop = if partial { norm.len() } else { end };
                keep[i + k..stop].fill(false);
                next = stop;
                break;
            }
        }
        i = next;
    }
    (0..norm.len()).filter(|&j| keep[j]).collect()
}

/// Remove decoding loops from a transcript, keeping text and words in step.
fn drop_loops(text: String, words: Vec<Word>) -> (String, Vec<Word>) {
    let shown: Vec<&str> = words.iter().map(|w| w.punctuated_word.as_deref().unwrap_or(&w.text)).collect();
    let kept = loop_free(&shown);
    if kept.len() == words.len() {
        return (text, words);
    }
    let text = kept.iter().map(|&j| shown[j]).collect::<Vec<_>>().join(" ");
    let mut words = words;
    let mut index = 0;
    words.retain(|_| {
        let keep = kept.binary_search(&index).is_ok();
        index += 1;
        keep
    });
    (text, words)
}

/// Verify that the local model can create a usable inference state.
pub fn validate_model(path: &Path) -> Result<(), SttError> {
    let context = WhisperContext::new_with_params(&path.to_string_lossy(), WhisperContextParameters::default())
        .map_err(|e| SttError::ModelNotFound(format!("Could not load offline speech: {e}")))?;
    context.create_state().map_err(|e| SttError::ModelNotFound(format!("Could not prepare offline speech: {e}")))?;
    Ok(())
}

/// Convert i16 PCM samples to f32 in [-1.0, 1.0] range.
fn i16_to_f32(samples: &[i16]) -> Vec<f32> {
    samples.iter().map(|&s| f32::from(s) / 32768.0).collect()
}

/// Mean token probability for a segment — Whisper's per-token confidence.
/// Falls back to 0.0 if the token data is unavailable.
fn segment_confidence(state: &WhisperState, segment: i32) -> f64 {
    let n_tokens = state.full_n_tokens(segment).unwrap_or(0);
    if n_tokens == 0 {
        return 0.0;
    }
    let mut sum = 0.0_f64;
    let mut count = 0u32;
    for t in 0..n_tokens {
        if let Ok(p) = state.full_get_token_prob(segment, t) {
            sum += f64::from(p);
            count += 1;
        }
    }
    if count == 0 { 0.0 } else { sum / f64::from(count) }
}

/// Extract transcript text, words, and a real average confidence (mean token
/// probability) from Whisper state.
#[expect(clippy::cast_precision_loss, reason = "timestamps and word counts are small enough")]
fn extract_segments(state: &WhisperState) -> (String, Vec<Word>, f64) {
    let n_segments = state.full_n_segments().unwrap_or(0);
    let mut full_text = String::new();
    let mut words = Vec::new();
    let mut total_confidence: f64 = 0.0;

    for i in 0..n_segments {
        let text = state.full_get_segment_text(i).unwrap_or_default();
        let start_ts = state.full_get_segment_t0(i).unwrap_or(0);
        let end_ts = state.full_get_segment_t1(i).unwrap_or(0);

        let start_sec = start_ts as f64 / 100.0;
        let end_sec = end_ts as f64 / 100.0;
        // Real per-segment confidence from Whisper token probabilities (was
        // previously hardcoded to 0.9, which made downstream confidence
        // filtering useless and let hallucinations through).
        let confidence = segment_confidence(state, i);

        let n_words = text.split_whitespace().count();
        if n_words > 0 {
            let duration_per_word = (end_sec - start_sec) / n_words as f64;
            for (j, word_text) in text.split_whitespace().enumerate() {
                let w_start = start_sec + (j as f64 * duration_per_word);
                let w_end = w_start + duration_per_word;
                words.push(Word {
                    text: word_text.to_lowercase(),
                    start: w_start,
                    end: w_end,
                    confidence,
                    punctuated_word: Some(word_text.to_string()),
                });
            }
        }

        full_text.push_str(&text);
        total_confidence += confidence;
    }

    let avg_confidence = if n_segments > 0 {
        total_confidence / f64::from(n_segments)
    } else {
        0.0
    };

    (full_text.trim().to_string(), words, avg_confidence)
}

/// Minimum mean-token-probability for a Whisper segment to be trusted. Below
/// this, the text is almost always a hallucination on silence / ambient noise.
const WHISPER_MIN_CONFIDENCE: f64 = 0.55;

/// Phrases Whisper notoriously hallucinates on near-silent or noisy audio
/// (training-data artifacts from YouTube captions). Compared after lowercasing
/// and stripping surrounding punctuation/whitespace.
const HALLUCINATION_PHRASES: &[&str] = &[
    "thank you",
    "thank you.",
    "thanks for watching",
    "thanks for watching!",
    "thank you for watching",
    "thank you for watching.",
    "please subscribe",
    "like and subscribe",
    "see you next time",
    "see you in the next video",
    "bye",
    "bye.",
    "you",
    "the end",
    "subtitles by the amara.org community",
    "♪",
    "[music]",
    "(music)",
    "[silence]",
    "[applause]",
    "(applause)",
];

/// Decide whether a Whisper transcript segment is real speech worth emitting.
/// Filters empty text, low-confidence output, and known hallucination phrases.
fn is_real_speech(text: &str, confidence: f64, min_confidence: f64) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return false;
    }
    // Normalize for denylist comparison: lowercase, strip wrapping punctuation.
    let normalized = trimmed
        .to_lowercase()
        .trim_matches(|c: char| !c.is_alphanumeric())
        .to_string();
    if HALLUCINATION_PHRASES.contains(&normalized.as_str())
        || HALLUCINATION_PHRASES.contains(&trimmed.to_lowercase().as_str())
    {
        // Canned phrase — only allow it through with strong confidence, since
        // "thank you" can be legitimately spoken.
        return confidence >= 0.80;
    }
    confidence >= min_confidence
}

/// Local Whisper STT provider.
pub struct WhisperProvider {
    model_path: PathBuf,
    language: Option<String>,
    n_threads: i32,
    cancelled: Arc<AtomicBool>,
}

impl WhisperProvider {
    /// Create a new Whisper provider.
    ///
    /// - `model_path`: path to a GGML model file
    /// - `language`: ISO language code (e.g. "en") or `None` for auto-detect
    /// - `n_threads`: number of CPU threads for inference
    pub fn new(model_path: PathBuf, language: Option<String>, n_threads: i32) -> Self {
        Self {
            model_path,
            language,
            n_threads: n_threads.max(1),
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }
}

impl std::fmt::Debug for WhisperProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WhisperProvider")
            .field("model_path", &self.model_path)
            .field("language", &self.language)
            .field("n_threads", &self.n_threads)
            .finish_non_exhaustive()
    }
}

#[async_trait::async_trait]
impl SttProvider for WhisperProvider {
    #[expect(clippy::too_many_lines, reason = "spawns two blocking tasks with setup; splitting would obscure the pipeline flow")]
    async fn start(
        &self,
        audio_rx: Receiver<Vec<i16>>,
        event_tx: mpsc::Sender<TranscriptEvent>,
    ) -> Result<(), SttError> {
        if !self.model_path.exists() {
            return Err(SttError::ModelNotFound(format!(
                "Whisper model not found: {}",
                self.model_path.display()
            )));
        }

        let model_path = self.model_path.clone();
        let language = self.language.clone();
        let n_threads = self.n_threads;
        let cancelled = self.cancelled.clone();

        let (inference_tx, mut inference_rx) = mpsc::channel::<Vec<i16>>(4);

        // ── Task 1: VAD + audio accumulation ─────────────────────────────
        let vad_cancelled = cancelled.clone();
        let vad_event_tx = event_tx.clone();
        let vad_handle = tokio::task::spawn_blocking(move || {
            use rhema_audio::{AudioFrame, Vad, VadConfig, VadTransition};

            // Lower thresholds to pick up room/ambient audio (speaker at a
            // podium, mic on a desk). Tradeoff: more background noise reaches
            // Whisper, but suppress_non_speech_tokens handles most hallucinations.
            let vad_config = VadConfig {
                silence_threshold: 0.003,
                frame_threshold: 0.002,
                min_voice_frames: 3,
                ..VadConfig::default()
            };
            let mut vad = Vad::new(vad_config);
            let mut audio_buffer: Vec<i16> = Vec::new();
            // Capture sends whatever the device delivers (171 samples from a
            // Mac's built-in mic at 48 kHz). The VAD counts frames and its
            // timings assume 1,024 each; without regrouping, clips were cut
            // every 2.6 s instead of 15 s and 128 ms of quiet ended speech.
            let mut pending: Vec<i16> = Vec::with_capacity(VAD_FRAME_SAMPLES * 2);

            loop {
                if vad_cancelled.load(Ordering::SeqCst) {
                    if audio_buffer.len() >= MIN_BUFFER_SAMPLES {
                        let _ = inference_tx.blocking_send(std::mem::take(&mut audio_buffer));
                    }
                    break;
                }

                match audio_rx.recv_timeout(Duration::from_millis(50)) {
                    Ok(samples) => {
                        pending.extend_from_slice(&samples);
                        while pending.len() >= VAD_FRAME_SAMPLES {
                            let frame = AudioFrame { samples: pending.drain(..VAD_FRAME_SAMPLES).collect(), timestamp_ms: 0 };
                            let result = vad.process(&frame);

                            if let Some(transition) = result.transition {
                                match transition {
                                    VadTransition::SpeechStarted => {
                                        let _ = vad_event_tx
                                            .blocking_send(TranscriptEvent::SpeechStarted);
                                    }
                                    VadTransition::SpeechEnded => {
                                        if audio_buffer.len() >= MIN_BUFFER_SAMPLES {
                                            let _ = inference_tx
                                                .blocking_send(std::mem::take(&mut audio_buffer));
                                        } else {
                                            audio_buffer.clear();
                                        }
                                    }
                                }
                            }

                            for frame in result.frames {
                                audio_buffer.extend_from_slice(&frame.samples);
                            }

                            if audio_buffer.len() >= MAX_BUFFER_SAMPLES {
                                let _ = inference_tx.blocking_send(std::mem::take(&mut audio_buffer));
                            }
                        }
                    }
                    Err(crossbeam_channel::RecvTimeoutError::Timeout) => {}
                    Err(crossbeam_channel::RecvTimeoutError::Disconnected) => {
                        if audio_buffer.len() >= MIN_BUFFER_SAMPLES {
                            let _ = inference_tx.blocking_send(std::mem::take(&mut audio_buffer));
                        }
                        break;
                    }
                }
            }
        });

        // ── Task 2: Whisper inference ────────────────────────────────────
        let inf_cancelled = cancelled.clone();
        let inf_event_tx = event_tx.clone();
        let inf_handle = tokio::task::spawn_blocking(move || {
            let ctx = match WhisperContext::new_with_params(
                &model_path.to_string_lossy(),
                WhisperContextParameters::default(),
            ) {
                Ok(ctx) => ctx,
                Err(e) => {
                    log::error!("[Whisper] Failed to load model: {e}");
                    let _ = inf_event_tx.blocking_send(TranscriptEvent::Error(
                        format!("Failed to load Whisper model: {e}"),
                    ));
                    return;
                }
            };

            let mut state = match ctx.create_state() {
                Ok(s) => s,
                Err(e) => {
                    log::error!("[Whisper] Failed to create state: {e}");
                    let _ = inf_event_tx.blocking_send(TranscriptEvent::Error(
                        format!("Failed to create Whisper state: {e}"),
                    ));
                    return;
                }
            };

            log::info!("[Whisper] Model loaded, ready for inference");
            if CPU_ONLY {
                log::info!("[Whisper] Running on the CPU: encoding each clip's length instead of a full 30 s window");
            }
            let _ = inf_event_tx.blocking_send(TranscriptEvent::Connected);

            while let Some(audio_i16) = inference_rx.blocking_recv() {
                if inf_cancelled.load(Ordering::SeqCst) {
                    break;
                }

                let audio_f32 = i16_to_f32(&audio_i16);

                let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
                params.set_language(Some(
                    language.as_deref().unwrap_or("en"),
                ));
                params.set_n_threads(n_threads);
                params.set_print_progress(false);
                params.set_print_special(false);
                params.set_print_realtime(false);
                params.set_single_segment(false);
                params.set_token_timestamps(true);
                params.set_no_speech_thold(0.4);
                params.set_suppress_blank(true);
                params.set_suppress_non_speech_tokens(true);
                if CPU_ONLY {
                    params.set_audio_ctx(trimmed_audio_ctx(audio_i16.len()));
                    // A retry at higher temperature costs another full pass
                    // (up to 30 s here); loops are removed afterwards instead.
                    params.set_temperature_inc(0.0);
                }

                let start = std::time::Instant::now();
                if let Err(e) = state.full(params, &audio_f32) {
                    log::error!("[Whisper] Inference error: {e}");
                    let _ = inf_event_tx.blocking_send(TranscriptEvent::Error(
                        format!("Whisper inference error: {e}"),
                    ));
                    continue;
                }
                let elapsed = start.elapsed();

                let (text, words, confidence) = extract_segments(&state);
                let (text, mut words) = if CPU_ONLY { drop_loops(text, words) } else { (text, words) };
                let singing = SINGING.load(Ordering::Relaxed);
                let (text, min_confidence) = if singing {
                    words.retain(|w| w.text.chars().any(char::is_alphanumeric));
                    (strip_music_marks(&text), SINGING_MIN_CONFIDENCE)
                } else {
                    (text, WHISPER_MIN_CONFIDENCE)
                };

                #[expect(clippy::cast_precision_loss, reason = "audio sample count fits in f64")]
                let audio_duration_s = audio_i16.len() as f64 / 16_000.0;
                log::info!(
                    "[Whisper] Transcribed {audio_duration_s:.1}s audio in {elapsed:.1?} (conf {confidence:.2}): \"{text}\""
                );

                if is_real_speech(&text, confidence, min_confidence) {
                    let _ = inf_event_tx.blocking_send(TranscriptEvent::Final {
                        transcript: text,
                        words,
                        confidence,
                        speech_final: true,
                    });
                } else {
                    log::info!(
                        "[Whisper] Dropped low-confidence/hallucinated segment (conf {confidence:.2}): \"{text}\""
                    );
                }

                let _ = inf_event_tx.blocking_send(TranscriptEvent::UtteranceEnd);
            }

            log::info!("[Whisper] Inference task exiting");
        });

        let _ = tokio::join!(vad_handle, inf_handle);
        let _ = event_tx.send(TranscriptEvent::Disconnected).await;

        Ok(())
    }

    fn stop(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    fn name(&self) -> &'static str {
        "whisper"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clean(text: &str) -> String {
        let words: Vec<&str> = text.split_whitespace().collect();
        loop_free(&words).iter().map(|&i| words[i]).collect::<Vec<_>>().join(" ")
    }

    #[test]
    fn music_marks_are_stripped() {
        assert_eq!(strip_music_marks("♪ We raise a sound, we raise a sound ♪"), "We raise a sound, we raise a sound");
        assert_eq!(strip_music_marks("♪♪♪"), "");
        assert_eq!(strip_music_marks("Good morning. ♪♪"), "Good morning.");
    }

    #[test]
    fn singing_keeps_less_certain_lines() {
        let line = "My, my, I'm in the water";
        assert!(!is_real_speech(line, 0.46, WHISPER_MIN_CONFIDENCE));
        assert!(is_real_speech(line, 0.46, SINGING_MIN_CONFIDENCE));
        assert!(!is_real_speech("the", 0.28, SINGING_MIN_CONFIDENCE));
        assert!(!is_real_speech("Thank you.", 0.53, SINGING_MIN_CONFIDENCE));
        assert!(!is_real_speech("", 0.9, SINGING_MIN_CONFIDENCE));
    }

    #[test]
    fn trimmed_window_covers_the_clip_plus_margin() {
        assert_eq!(trimmed_audio_ctx(16_000 * 3), 150 + 256);
        assert_eq!(trimmed_audio_ctx(16_000 * 3 + 1), 151 + 256);
        assert_eq!(trimmed_audio_ctx(16_000 * 30), 1500);
    }

    #[test]
    fn loops_cut_to_one_copy() {
        // Loops Whisper produced on a real recording.
        assert_eq!(
            clean("I'm very happy to be here. I'm very happy to be here. I'm very happy to be here. I'm very happy to be here."),
            "I'm very happy to be here."
        );
        assert_eq!(
            clean("It's command. Why it's the drivers? The Wixons? Why it's the drivers? The Wixons? Why it's the drivers?"),
            "It's command. Why it's the drivers? The Wixons?"
        );
        assert_eq!(clean("So he said no. Come in, come in, come in, come in now"), "So he said no. Come in, now");
    }

    #[test]
    fn ordinary_repeats_are_kept() {
        for text in [
            "Holy, holy, holy! Lord God Almighty",
            "Thank you. Thank you.",
            "What is mother? What is mother?",
            "Hallelujah hallelujah hallelujah hallelujah",
            "",
        ] {
            assert_eq!(clean(text), text);
        }
    }

    #[test]
    fn dropping_loops_keeps_words_in_step() {
        let words: Vec<Word> = "go on go on go on now"
            .split(' ')
            .zip(0_u32..)
            .map(|(w, i)| Word { text: w.into(), start: f64::from(i), end: f64::from(i) + 1.0, confidence: 0.9, punctuated_word: Some(w.into()) })
            .collect();
        let (text, words) = drop_loops("go on go on go on now".into(), words);
        assert_eq!(text, "go on now");
        assert_eq!(words.iter().map(|w| w.start).collect::<Vec<_>>(), vec![0.0, 1.0, 6.0]);
    }
}
