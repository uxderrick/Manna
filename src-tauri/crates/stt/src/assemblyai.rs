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
use crate::types::{SttConfig, TranscriptEvent};

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

    pub fn stop(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
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
        _audio_rx: Receiver<Vec<i16>>,
        _event_tx: mpsc::Sender<TranscriptEvent>,
    ) -> Result<(), SttError> {
        // Implementation lands in Task 2
        Err(SttError::ConnectionFailed("not yet implemented".into()))
    }

    fn stop(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    fn name(&self) -> &'static str {
        "assemblyai"
    }
}
