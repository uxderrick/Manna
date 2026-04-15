//! AssemblyAI Universal-Streaming STT provider.
//!
//! Streams 16-bit PCM audio at 16 kHz to AssemblyAI's `/v3/ws` endpoint and
//! translates its `Begin` / `Turn` / `Termination` messages into the shared
//! [`TranscriptEvent`] enum. The WebSocket/reconnect scaffolding lives in
//! [`crate::ws_runtime`] and is shared with [`crate::deepgram::DeepgramClient`].

use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use crossbeam_channel::Receiver;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use url::Url;

use crate::error::SttError;
use crate::keyterms::priority_keyterms;
use crate::provider::SttProvider;
use crate::types::{SttConfig, TranscriptEvent, Word};
use crate::ws_runtime::{run_stream, WsProvider};

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
}

impl WsProvider for AssemblyAIClient {
    fn log_tag(&self) -> &'static str {
        "AssemblyAIClient"
    }

    fn build_url(&self) -> Result<Url, SttError> {
        let mut url = Url::parse("wss://streaming.assemblyai.com/v3/ws")
            .map_err(|e| SttError::ConnectionFailed(e.to_string()))?;
        {
            let mut q = url.query_pairs_mut();
            // v3 Universal-Streaming model. Older "u3-pro" is deprecated; use "u3-rt-pro".
            q.append_pair("speech_model", "u3-rt-pro");
            q.append_pair("sample_rate", &self.config.sample_rate.to_string());
            q.append_pair("encoding", "pcm_s16le");
            q.append_pair("format_turns", "true");
            // AAI expects keyterms_prompt as a JSON-encoded array string, not comma-separated.
            let all = priority_keyterms(100);
            let keyterms_json = serde_json::to_string(&all)
                .map_err(|e| SttError::ConnectionFailed(e.to_string()))?;
            q.append_pair("keyterms_prompt", &keyterms_json);
            log::info!("AssemblyAI keyterms_prompt: {} terms", all.len());
        }
        log::info!("AssemblyAI WebSocket URL: {}", url.as_str());
        Ok(url)
    }

    fn auth_header(&self) -> Result<Option<HeaderValue>, SttError> {
        // v3 Universal-Streaming authenticates via `Authorization: <raw-api-key>`.
        HeaderValue::from_str(&self.config.api_key)
            .map(Some)
            .map_err(|e| SttError::ConnectionFailed(e.to_string()))
    }

    fn keepalive_frame(&self) -> Option<String> {
        // v3 Universal-Streaming tolerates silence; no keepalive message documented.
        None
    }

    fn close_frame(&self) -> String {
        serde_json::json!({ "type": "Terminate" }).to_string()
    }

    fn parse_message<'a>(
        &'a self,
        text: &'a str,
        event_tx: &'a mpsc::Sender<TranscriptEvent>,
    ) -> Pin<Box<dyn std::future::Future<Output = Result<bool, SttError>> + Send + 'a>> {
        Box::pin(parse_and_send(text, event_tx))
    }
}

#[async_trait::async_trait]
impl SttProvider for AssemblyAIClient {
    async fn start(
        &self,
        audio_rx: Receiver<Vec<i16>>,
        event_tx: mpsc::Sender<TranscriptEvent>,
    ) -> Result<(), SttError> {
        run_stream(
            self,
            self.config.api_key.is_empty(),
            audio_rx,
            event_tx,
            self.cancelled.clone(),
        )
        .await
    }

    fn stop(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    fn name(&self) -> &'static str {
        "assemblyai"
    }
}

/// Parse an AssemblyAI JSON message and forward the corresponding `TranscriptEvent`.
///
/// AssemblyAI Universal-Streaming v3 emits:
/// - `{"type": "Begin", ...}` when the session opens
/// - `{"type": "Turn", "transcript": "...", "end_of_turn": bool, ...}` for partials/finals
/// - `{"type": "Termination", ...}` when the session closes
/// - `{"error": "..."}` on errors
async fn parse_and_send(
    text: &str,
    event_tx: &mpsc::Sender<TranscriptEvent>,
) -> Result<bool, SttError> {
    let json: serde_json::Value =
        serde_json::from_str(text).map_err(|e| SttError::ParseError(e.to_string()))?;

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

    log::info!("[AssemblyAI] recv type={msg_type}");

    match msg_type {
        "Begin" => {
            log::info!("[AssemblyAI] session Begin");
            Ok(false)
        }
        "Termination" => {
            log::info!("[AssemblyAI] session Termination");
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
        _ => Ok(false),
    }
}
