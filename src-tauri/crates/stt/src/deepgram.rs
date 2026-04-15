//! Deepgram WebSocket STT provider.
//!
//! Streams 16-bit PCM audio at 16 kHz to Deepgram's `/v1/listen` endpoint and
//! translates Nova-3 result messages into the shared [`TranscriptEvent`] enum.
//! The WebSocket/reconnect scaffolding lives in [`crate::ws_runtime`] and is
//! shared with [`crate::assemblyai::AssemblyAIClient`]. If the WebSocket path
//! repeatedly fails, [`SttProvider::start`] degrades to the REST fallback.

use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use crossbeam_channel::Receiver;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use url::Url;

use crate::error::SttError;
use crate::keyterms::priority_keyterms;
use crate::provider::SttProvider;
use crate::types::{SttConfig, TranscriptEvent, Word};
use crate::ws_runtime::{run_stream, WsProvider};

pub struct DeepgramClient {
    config: SttConfig,
    cancelled: Arc<AtomicBool>,
}

impl std::fmt::Debug for DeepgramClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DeepgramClient")
            .field("model", &self.config.model)
            .finish_non_exhaustive()
    }
}

impl DeepgramClient {
    pub fn new(config: SttConfig) -> Self {
        Self {
            config,
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }
}

impl WsProvider for DeepgramClient {
    fn log_tag(&self) -> &'static str {
        "DeepgramClient"
    }

    fn build_url(&self) -> Result<Url, SttError> {
        let mut url = Url::parse("wss://api.deepgram.com/v1/listen")
            .map_err(|e| SttError::ConnectionFailed(e.to_string()))?;

        {
            let mut q = url.query_pairs_mut();
            q.append_pair("model", &self.config.model);
            q.append_pair("encoding", &self.config.encoding);
            q.append_pair("sample_rate", &self.config.sample_rate.to_string());
            q.append_pair("channels", "1");
            q.append_pair("punctuate", "true");
            q.append_pair("smart_format", "true");
            q.append_pair("interim_results", "true");
            q.append_pair("endpointing", "300");
            q.append_pair("utterance_end_ms", "1000");
            q.append_pair("vad_events", "true");

            if let Some(ref lang) = self.config.language {
                q.append_pair("language", lang);
            }

            // Nova-3 keyterm boosting: one per query param, max 100.
            let all_keyterms = priority_keyterms(100);
            for term in &all_keyterms {
                q.append_pair("keyterm", term);
            }
            log::info!(
                "Deepgram keyterm boosting: {} keyterms added",
                all_keyterms.len()
            );
        }

        log::info!("Deepgram WebSocket URL: {}", url.as_str());
        Ok(url)
    }

    fn auth_header(&self) -> Result<Option<HeaderValue>, SttError> {
        let auth_value = format!("Token {}", self.config.api_key);
        HeaderValue::from_str(&auth_value)
            .map(Some)
            .map_err(|e| SttError::ConnectionFailed(e.to_string()))
    }

    fn keepalive_frame(&self) -> Option<String> {
        Some(serde_json::json!({ "type": "KeepAlive" }).to_string())
    }

    fn close_frame(&self) -> String {
        serde_json::json!({ "type": "CloseStream" }).to_string()
    }

    fn parse_message<'a>(
        &'a self,
        text: &'a str,
        event_tx: &'a mpsc::Sender<TranscriptEvent>,
    ) -> Pin<Box<dyn std::future::Future<Output = Result<bool, SttError>> + Send + 'a>> {
        Box::pin(async move {
            parse_and_send(text, event_tx).await?;
            Ok(false)
        })
    }
}

#[async_trait::async_trait]
impl SttProvider for DeepgramClient {
    async fn start(
        &self,
        audio_rx: Receiver<Vec<i16>>,
        event_tx: mpsc::Sender<TranscriptEvent>,
    ) -> Result<(), SttError> {
        let result = run_stream(
            self,
            self.config.api_key.is_empty(),
            audio_rx.clone(),
            event_tx.clone(),
            self.cancelled.clone(),
        )
        .await;

        // On max reconnect failure, fall back to REST mode (hybrid).
        if let Err(ref e) = result {
            log::warn!(
                "[STT-Deepgram] WebSocket failed after retries: {e}, switching to REST fallback"
            );
            // Not a fatal error — we're degrading to REST mode.
            // Emit Reconnecting so the UI stays in "transcribing" state.
            let _ = event_tx.send(TranscriptEvent::Reconnecting).await;

            let rest_client = crate::rest::DeepgramRestClient::new(self.config.clone());
            let mut audio_buffer: Vec<i16> = Vec::new();
            let flush_interval = Duration::from_secs(5);
            let mut last_flush = std::time::Instant::now();
            let cancelled = self.cancelled.clone();

            loop {
                if cancelled.load(Ordering::SeqCst) {
                    break;
                }

                match audio_rx.recv_timeout(Duration::from_millis(100)) {
                    Ok(samples) => {
                        audio_buffer.extend(samples);
                        if last_flush.elapsed() >= flush_interval && !audio_buffer.is_empty() {
                            flush_rest(&rest_client, &mut audio_buffer, &event_tx).await;
                            last_flush = std::time::Instant::now();
                        }
                    }
                    Err(crossbeam_channel::RecvTimeoutError::Timeout) => {
                        if last_flush.elapsed() >= flush_interval && !audio_buffer.is_empty() {
                            flush_rest(&rest_client, &mut audio_buffer, &event_tx).await;
                            last_flush = std::time::Instant::now();
                        }
                    }
                    Err(crossbeam_channel::RecvTimeoutError::Disconnected) => break,
                }
            }
        }

        Ok(())
    }

    fn stop(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    fn name(&self) -> &'static str {
        "deepgram"
    }
}

async fn flush_rest(
    rest_client: &crate::rest::DeepgramRestClient,
    audio_buffer: &mut Vec<i16>,
    event_tx: &mpsc::Sender<TranscriptEvent>,
) {
    match rest_client.transcribe(audio_buffer).await {
        Ok(events) => {
            for evt in events {
                let _ = event_tx.send(evt).await;
            }
        }
        Err(e) => log::error!("[STT-REST] Transcription failed: {e}"),
    }
    audio_buffer.clear();
}

/// Parse a Deepgram JSON response and send the corresponding `TranscriptEvent`.
async fn parse_and_send(
    text: &str,
    event_tx: &mpsc::Sender<TranscriptEvent>,
) -> Result<(), SttError> {
    let json: serde_json::Value =
        serde_json::from_str(text).map_err(|e| SttError::ParseError(e.to_string()))?;

    let msg_type = json
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or_default();

    match msg_type {
        "UtteranceEnd" => {
            let _ = event_tx.send(TranscriptEvent::UtteranceEnd).await;
            return Ok(());
        }
        "SpeechStarted" => {
            let _ = event_tx.send(TranscriptEvent::SpeechStarted).await;
            return Ok(());
        }
        "Results" => { /* fall through */ }
        _ => return Ok(()),
    }

    let is_final = json
        .get("is_final")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);

    let speech_final = json
        .get("speech_final")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);

    let first_alt = json
        .get("channel")
        .and_then(|c| c.get("alternatives"))
        .and_then(|a| a.as_array())
        .and_then(|arr| arr.first());

    let transcript = first_alt
        .and_then(|a| a.get("transcript"))
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string();

    let confidence = first_alt
        .and_then(|a| a.get("confidence"))
        .and_then(serde_json::Value::as_f64)
        .unwrap_or(0.0);

    let words = first_alt
        .and_then(|a| a.get("words"))
        .and_then(|w| w.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|w| {
                    Some(Word {
                        text: w.get("word")?.as_str()?.to_string(),
                        start: w.get("start")?.as_f64()?,
                        end: w.get("end")?.as_f64()?,
                        confidence: w.get("confidence")?.as_f64()?,
                        punctuated_word: w
                            .get("punctuated_word")
                            .and_then(|p| p.as_str())
                            .map(ToString::to_string),
                    })
                })
                .collect::<Vec<Word>>()
        })
        .unwrap_or_default();

    let event = if is_final {
        TranscriptEvent::Final {
            transcript,
            words,
            confidence,
            speech_final,
        }
    } else {
        TranscriptEvent::Partial { transcript, words }
    };

    event_tx
        .send(event)
        .await
        .map_err(|e| SttError::SendError(e.to_string()))?;

    Ok(())
}
