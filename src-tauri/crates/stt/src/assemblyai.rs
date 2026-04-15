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
