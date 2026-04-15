//! AssemblyAI Universal-Streaming STT provider.
//!
//! Streams 16-bit PCM audio at 16 kHz to AssemblyAI's `/v3/ws` endpoint and
//! translates its `Begin` / `Turn` / `Termination` messages into the shared
//! [`TranscriptEvent`] enum. Structure mirrors [`crate::deepgram::DeepgramClient`]
//! so reconnect/stop/audio-drop semantics stay consistent across providers.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use crossbeam_channel::Receiver;
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;
use url::Url;

use crate::error::SttError;
use crate::keyterms::bible_keyterms;
use crate::provider::SttProvider;
use crate::types::{SttConfig, TranscriptEvent, Word};

const MAX_RECONNECT_ATTEMPTS: u32 = 5;
const RECONNECT_DELAY: Duration = Duration::from_secs(1);
/// Batch up to 250ms of audio before sending (at 16kHz, that is 4000 samples).
const BATCH_SAMPLES: usize = 4000;

pub struct AssemblyAIClient {
    config: SttConfig,
    cancelled: Arc<AtomicBool>,
}

impl std::fmt::Debug for AssemblyAIClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AssemblyAIClient")
            .field("model", &self.config.model)
            .finish_non_exhaustive()
    }
}

impl AssemblyAIClient {
    pub fn new(config: SttConfig) -> Self {
        Self {
            config,
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Build the AssemblyAI WebSocket URL with query parameters and keyterm boosting.
    fn build_url(&self) -> Result<Url, SttError> {
        let mut url = Url::parse("wss://streaming.assemblyai.com/v3/ws")
            .map_err(|e| SttError::ConnectionFailed(e.to_string()))?;

        {
            let mut q = url.query_pairs_mut();
            q.append_pair("sample_rate", &self.config.sample_rate.to_string());
            q.append_pair("encoding", "pcm_s16le");
            q.append_pair("format_turns", "true");

            // Reuse the same keyterm priority list as Deepgram.
            // AssemblyAI accepts a single `keyterms_prompt` query param with
            // comma-separated phrases. Cap at 100 to match Deepgram budget.
            let core_terms = [
                "Jesus",
                "Christ",
                "God",
                "Lord",
                "Holy Spirit",
            ];
            let bible_terms = bible_keyterms();
            let mut seen = std::collections::HashSet::new();
            let mut all: Vec<String> = Vec::new();
            for term in core_terms.iter().map(|s| (*s).to_string()).chain(bible_terms.into_iter()) {
                if seen.insert(term.clone()) {
                    all.push(term);
                }
                if all.len() >= 100 {
                    break;
                }
            }
            q.append_pair("keyterms_prompt", &all.join(","));
            log::info!("AssemblyAI keyterms_prompt: {} terms", all.len());
        }

        log::info!("AssemblyAI WebSocket URL: {}", url.as_str());
        Ok(url)
    }
}

#[async_trait::async_trait]
impl SttProvider for AssemblyAIClient {
    async fn start(
        &self,
        audio_rx: Receiver<Vec<i16>>,
        event_tx: mpsc::Sender<TranscriptEvent>,
    ) -> Result<(), SttError> {
        if self.config.api_key.is_empty() {
            return Err(SttError::ApiKeyMissing);
        }

        let cancelled = self.cancelled.clone();
        let mut attempts: u32 = 0;

        loop {
            if cancelled.load(Ordering::SeqCst) {
                log::info!("AssemblyAIClient: cancelled, stopping connection loop");
                break;
            }

            match self
                .try_connect(audio_rx.clone(), event_tx.clone(), cancelled.clone())
                .await
            {
                Ok(()) => {
                    if cancelled.load(Ordering::SeqCst) {
                        log::info!("AssemblyAIClient: connection closed normally (cancelled)");
                        break;
                    }
                    // Audio source gone → stop reconnecting into a dead channel.
                    if matches!(
                        audio_rx.try_recv(),
                        Err(crossbeam_channel::TryRecvError::Disconnected)
                    ) {
                        log::info!("AssemblyAIClient: audio source closed, stopping reconnect loop");
                        break;
                    }
                    log::info!("AssemblyAIClient: server closed connection, reconnecting...");
                    let _ = event_tx.send(TranscriptEvent::Reconnecting).await;
                    attempts = 0;
                    tokio::time::sleep(Duration::from_millis(500)).await;
                    continue;
                }
                Err(e) => {
                    attempts += 1;
                    log::warn!(
                        "AssemblyAIClient: connection error (attempt {attempts}/{MAX_RECONNECT_ATTEMPTS}): {e}"
                    );
                    let _ = event_tx.send(TranscriptEvent::Reconnecting).await;

                    if attempts >= MAX_RECONNECT_ATTEMPTS {
                        log::error!("AssemblyAIClient: max reconnection attempts reached");
                        let _ = event_tx
                            .send(TranscriptEvent::Error(format!(
                                "Max reconnection attempts reached: {e}"
                            )))
                            .await;
                        return Err(e);
                    }

                    tokio::time::sleep(RECONNECT_DELAY).await;
                }
            }
        }

        Ok(())
    }

    fn stop(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    fn name(&self) -> &'static str {
        "assemblyai"
    }
}

impl AssemblyAIClient {
    /// Attempt a single WebSocket connection and run send/receive loops.
    #[allow(clippy::too_many_lines)]
    async fn try_connect(
        &self,
        audio_rx: Receiver<Vec<i16>>,
        event_tx: mpsc::Sender<TranscriptEvent>,
        cancelled: Arc<AtomicBool>,
    ) -> Result<(), SttError> {
        let url = self.build_url()?;

        let mut request = url
            .as_str()
            .into_client_request()
            .map_err(|e| SttError::ConnectionFailed(e.to_string()))?;

        // AssemblyAI uses the raw API key as the Authorization header
        // (no "Token" prefix, unlike Deepgram).
        request.headers_mut().insert(
            "Authorization",
            HeaderValue::from_str(&self.config.api_key)
                .map_err(|e| SttError::ConnectionFailed(e.to_string()))?,
        );

        let (ws_stream, _response) = tokio_tungstenite::connect_async(request)
            .await
            .map_err(|e| SttError::ConnectionFailed(e.to_string()))?;

        log::info!("AssemblyAIClient: connected");
        let _ = event_tx.send(TranscriptEvent::Connected).await;

        let (mut write, mut read) = ws_stream.split();

        let send_cancelled = cancelled.clone();
        let recv_cancelled = cancelled.clone();

        let send_error_flag = Arc::new(AtomicBool::new(false));
        let recv_error_flag = Arc::new(AtomicBool::new(false));
        let send_err = send_error_flag.clone();
        let recv_err = recv_error_flag.clone();

        // Bridge: blocking audio reader → async WebSocket writer.
        // AssemblyAI v3 Universal-Streaming tolerates silence gaps; no keepalive frame is required.
        #[allow(clippy::items_after_statements)]
        enum WsCommand {
            Audio(Vec<u8>),
            Close,
        }
        let (ws_tx, mut ws_rx) = tokio::sync::mpsc::channel::<WsCommand>(64);

        // Part 1: blocking audio reader thread.
        let audio_reader = {
            let ws_tx = ws_tx.clone();
            let cancelled = send_cancelled.clone();
            tokio::task::spawn_blocking(move || {
                let mut batch_buf: Vec<u8> = Vec::with_capacity(BATCH_SAMPLES * 2);
                let batch_byte_threshold = BATCH_SAMPLES * 2;

                loop {
                    if cancelled.load(Ordering::SeqCst) {
                        let _ = ws_tx.blocking_send(WsCommand::Close);
                        break;
                    }

                    match audio_rx.recv_timeout(Duration::from_millis(50)) {
                        Ok(samples) => {
                            for sample in &samples {
                                batch_buf.extend_from_slice(&sample.to_le_bytes());
                            }
                            if batch_buf.len() >= batch_byte_threshold {
                                let data = std::mem::take(&mut batch_buf);
                                if ws_tx.blocking_send(WsCommand::Audio(data)).is_err() {
                                    break;
                                }
                            }
                        }
                        Err(crossbeam_channel::RecvTimeoutError::Timeout) => {
                            if !batch_buf.is_empty() {
                                let data = std::mem::take(&mut batch_buf);
                                if ws_tx.blocking_send(WsCommand::Audio(data)).is_err() {
                                    break;
                                }
                            }
                        }
                        Err(crossbeam_channel::RecvTimeoutError::Disconnected) => {
                            if !batch_buf.is_empty() {
                                let data = std::mem::take(&mut batch_buf);
                                let _ = ws_tx.blocking_send(WsCommand::Audio(data));
                            }
                            let _ = ws_tx.blocking_send(WsCommand::Close);
                            break;
                        }
                    }
                }
            })
        };

        // Part 2: async WebSocket writer.
        let ws_writer = tokio::spawn(async move {
            while let Some(cmd) = ws_rx.recv().await {
                match cmd {
                    WsCommand::Audio(data) => {
                        if let Err(e) = write.send(Message::Binary(data.into())).await {
                            log::error!("AssemblyAIClient ws_writer: audio send error: {e}");
                            send_err.store(true, Ordering::SeqCst);
                            break;
                        }
                    }
                    WsCommand::Close => {
                        let close_msg = serde_json::json!({"type": "Terminate"}).to_string();
                        let _ = write.send(Message::Text(close_msg.into())).await;
                        let _ = write.close().await;
                        break;
                    }
                }
            }
        });

        // Receiver task: reads text frames and parses AssemblyAI JSON.
        let receiver = tokio::spawn(async move {
            while let Some(msg_result) = read.next().await {
                if recv_cancelled.load(Ordering::SeqCst) {
                    break;
                }

                match msg_result {
                    Ok(Message::Text(text)) => {
                        match parse_and_send(&text, &event_tx).await {
                            Ok(true) => break,
                            Ok(false) => {}
                            Err(e) => log::warn!("AssemblyAIClient receiver: parse error: {e}"),
                        }
                    }
                    Ok(Message::Close(_)) => {
                        log::info!("AssemblyAIClient receiver: server closed connection");
                        break;
                    }
                    Ok(_) => {
                        // Ignore binary/ping/pong frames.
                    }
                    Err(e) => {
                        log::error!("AssemblyAIClient receiver: WebSocket error: {e}");
                        recv_err.store(true, Ordering::SeqCst);
                        let _ = event_tx
                            .send(TranscriptEvent::Error(format!("WebSocket error: {e}")))
                            .await;
                        break;
                    }
                }
            }
        });

        let _ = tokio::join!(audio_reader, ws_writer, receiver);

        if send_error_flag.load(Ordering::SeqCst) || recv_error_flag.load(Ordering::SeqCst) {
            return Err(SttError::ConnectionFailed(
                "Connection lost unexpectedly".into(),
            ));
        }

        Ok(())
    }
}

/// Parse an AssemblyAI JSON message and forward the corresponding `TranscriptEvent`.
///
/// AssemblyAI Universal-Streaming v3 emits:
/// - `{"type": "Begin", ...}` when the session opens
/// - `{"type": "Turn", "transcript": "...", "end_of_turn": bool, "turn_is_formatted": bool, ...}` for partials/finals
/// - `{"type": "Termination", ...}` when the session closes
/// - `{"error": "..."}` on errors
async fn parse_and_send(
    text: &str,
    event_tx: &mpsc::Sender<TranscriptEvent>,
) -> Result<bool, SttError> {
    let json: serde_json::Value =
        serde_json::from_str(text).map_err(|e| SttError::ParseError(e.to_string()))?;

    // Error field takes precedence regardless of `type`.
    if let Some(err) = json.get("error").and_then(|v| v.as_str()) {
        let _ = event_tx
            .send(TranscriptEvent::Error(format!("AssemblyAI: {err}")))
            .await;
        return Ok(false);
    }

    let msg_type = json
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or_default();

    match msg_type {
        "Begin" => {
            // Connected already emitted on WebSocket open — ignore.
            Ok(false)
        }
        "Termination" => {
            // Clean server close — outer reconnect loop will emit Disconnected.
            Ok(true)
        }
        "Turn" => {
            let transcript = json
                .get("transcript")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();

            if transcript.is_empty() {
                return Ok(false);
            }

            let end_of_turn = json
                .get("end_of_turn")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            // AssemblyAI v3 Turn messages include a `words` array with
            // per-word text/start/end/confidence. Map to shared `Word`.
            let words = json
                .get("words")
                .and_then(|w| w.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|w| {
                            let text = w.get("text").and_then(|v| v.as_str())?.to_string();
                            let start_ms = w.get("start").and_then(serde_json::Value::as_f64)?;
                            let end_ms = w.get("end").and_then(serde_json::Value::as_f64)?;
                            let confidence = w
                                .get("confidence")
                                .and_then(serde_json::Value::as_f64)
                                .unwrap_or(0.0);
                            Some(Word {
                                text,
                                start: start_ms / 1000.0,
                                end: end_ms / 1000.0,
                                confidence,
                                punctuated_word: None,
                            })
                        })
                        .collect::<Vec<Word>>()
                })
                .unwrap_or_default();

            // Turn-level confidence: prefer `end_of_turn_confidence`, else average word confidence.
            let confidence = json
                .get("end_of_turn_confidence")
                .and_then(serde_json::Value::as_f64)
                .or_else(|| {
                    if words.is_empty() {
                        None
                    } else {
                        let sum: f64 = words.iter().map(|w| w.confidence).sum();
                        Some(sum / words.len() as f64)
                    }
                })
                .unwrap_or(0.0);

            if end_of_turn {
                let _ = event_tx
                    .send(TranscriptEvent::Final {
                        transcript,
                        confidence,
                        speech_final: true,
                        words,
                    })
                    .await;
            } else {
                let _ = event_tx
                    .send(TranscriptEvent::Partial { transcript, words })
                    .await;
            }
            Ok(false)
        }
        _ => {
            // Unknown message type — ignore silently.
            Ok(false)
        }
    }
}
