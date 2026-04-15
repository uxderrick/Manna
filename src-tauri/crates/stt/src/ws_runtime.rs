//! Shared WebSocket streaming runtime for cloud STT providers.
//!
//! Both Deepgram and AssemblyAI follow the same shape: open a WebSocket, batch
//! 16-bit PCM audio from a crossbeam channel, spawn a blocking audio reader →
//! async writer → async receiver pipeline, then reconnect on transient drops.
//! Only the URL, auth header, keepalive frame, close frame, and parser differ.
//!
//! Providers pass a [`WsProvider`] impl to [`run_stream`] and get the full
//! reconnect/audio-bridge/join machinery for free.

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
use crate::types::TranscriptEvent;

const MAX_RECONNECT_ATTEMPTS: u32 = 5;
const RECONNECT_DELAY: Duration = Duration::from_secs(1);
/// Batch up to 250ms of audio before sending (at 16kHz, that is 4000 samples).
const BATCH_SAMPLES: usize = 4000;

/// Per-provider customization of the shared WebSocket runtime.
///
/// Implementations are small: describe the URL + auth, what keepalive/close
/// frames to send, and how to parse an incoming text frame.
pub trait WsProvider: Send + Sync + 'static {
    /// Human-readable name used in log messages (e.g. "DeepgramClient").
    fn log_tag(&self) -> &'static str;

    /// Build the WebSocket URL, including any query parameters.
    fn build_url(&self) -> Result<Url, SttError>;

    /// Authorization header value (full value, including any "Token " prefix).
    fn auth_header(&self) -> Result<HeaderValue, SttError>;

    /// Keepalive frame to send during silence gaps. `None` disables keepalive.
    fn keepalive_frame(&self) -> Option<String>;

    /// Final text frame sent before closing (e.g. `{"type":"CloseStream"}`).
    fn close_frame(&self) -> String;

    /// Parse one text frame and forward events.
    ///
    /// Returns `Ok(true)` to break out of the receive loop (e.g. explicit
    /// termination message), `Ok(false)` to continue.
    fn parse_message<'a>(
        &'a self,
        text: &'a str,
        event_tx: &'a mpsc::Sender<TranscriptEvent>,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<bool, SttError>> + Send + 'a>>;
}

/// Run the full connect/reconnect loop for a WebSocket STT provider.
///
/// Emits [`TranscriptEvent::Connected`] on each successful open and
/// [`TranscriptEvent::Reconnecting`] before each retry. Honors `cancelled` and
/// stops cleanly when the audio channel is dropped.
pub async fn run_stream<P: WsProvider>(
    provider: &P,
    api_key_empty: bool,
    audio_rx: Receiver<Vec<i16>>,
    event_tx: mpsc::Sender<TranscriptEvent>,
    cancelled: Arc<AtomicBool>,
) -> Result<(), SttError> {
    if api_key_empty {
        return Err(SttError::ApiKeyMissing);
    }

    let tag = provider.log_tag();
    let mut attempts: u32 = 0;

    loop {
        if cancelled.load(Ordering::SeqCst) {
            log::info!("{tag}: cancelled, stopping connection loop");
            break;
        }

        match try_connect(provider, audio_rx.clone(), event_tx.clone(), cancelled.clone()).await {
            Ok(()) => {
                if cancelled.load(Ordering::SeqCst) {
                    log::info!("{tag}: connection closed normally (cancelled)");
                    break;
                }
                if matches!(
                    audio_rx.try_recv(),
                    Err(crossbeam_channel::TryRecvError::Disconnected)
                ) {
                    log::info!("{tag}: audio source closed, stopping reconnect loop");
                    break;
                }
                log::info!("{tag}: server closed connection, reconnecting...");
                let _ = event_tx.send(TranscriptEvent::Reconnecting).await;
                attempts = 0;
                tokio::time::sleep(Duration::from_millis(500)).await;
                continue;
            }
            Err(e) => {
                attempts += 1;
                log::warn!(
                    "{tag}: connection error (attempt {attempts}/{MAX_RECONNECT_ATTEMPTS}): {e}"
                );
                let _ = event_tx.send(TranscriptEvent::Reconnecting).await;

                if attempts >= MAX_RECONNECT_ATTEMPTS {
                    log::error!("{tag}: max reconnection attempts reached");
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

async fn try_connect<P: WsProvider>(
    provider: &P,
    audio_rx: Receiver<Vec<i16>>,
    event_tx: mpsc::Sender<TranscriptEvent>,
    cancelled: Arc<AtomicBool>,
) -> Result<(), SttError> {
    let tag = provider.log_tag();
    let url = provider.build_url()?;

    let mut request = url
        .as_str()
        .into_client_request()
        .map_err(|e| SttError::ConnectionFailed(e.to_string()))?;
    request
        .headers_mut()
        .insert("Authorization", provider.auth_header()?);

    let (ws_stream, _response) = tokio_tungstenite::connect_async(request)
        .await
        .map_err(|e| SttError::ConnectionFailed(e.to_string()))?;

    log::info!("{tag}: connected");
    let _ = event_tx.send(TranscriptEvent::Connected).await;

    let (mut write, mut read) = ws_stream.split();

    let send_cancelled = cancelled.clone();
    let recv_cancelled = cancelled.clone();

    let send_error_flag = Arc::new(AtomicBool::new(false));
    let recv_error_flag = Arc::new(AtomicBool::new(false));
    let send_err = send_error_flag.clone();
    let recv_err = recv_error_flag.clone();

    let keepalive = provider.keepalive_frame();
    let close_frame = provider.close_frame();

    #[allow(clippy::items_after_statements)]
    enum WsCommand {
        Audio(Vec<u8>),
        KeepAlive,
        Close,
    }
    let (ws_tx, mut ws_rx) = tokio::sync::mpsc::channel::<WsCommand>(64);

    // Blocking audio reader: crossbeam → tokio channel.
    let audio_reader = {
        let ws_tx = ws_tx.clone();
        let cancelled = send_cancelled.clone();
        let send_keepalive = keepalive.is_some();
        tokio::task::spawn_blocking(move || {
            let mut batch_buf: Vec<u8> = Vec::with_capacity(BATCH_SAMPLES * 2);
            let batch_byte_threshold = BATCH_SAMPLES * 2;
            let mut last_send = std::time::Instant::now();
            let keepalive_interval = Duration::from_secs(5);

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
                            last_send = std::time::Instant::now();
                        }
                    }
                    Err(crossbeam_channel::RecvTimeoutError::Timeout) => {
                        if !batch_buf.is_empty() {
                            let data = std::mem::take(&mut batch_buf);
                            if ws_tx.blocking_send(WsCommand::Audio(data)).is_err() {
                                break;
                            }
                            last_send = std::time::Instant::now();
                        }
                        if send_keepalive && last_send.elapsed() >= keepalive_interval {
                            if ws_tx.blocking_send(WsCommand::KeepAlive).is_err() {
                                break;
                            }
                            last_send = std::time::Instant::now();
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

    // Async writer: tokio channel → WebSocket.
    let ws_writer = tokio::spawn(async move {
        while let Some(cmd) = ws_rx.recv().await {
            match cmd {
                WsCommand::Audio(data) => {
                    if let Err(e) = write.send(Message::Binary(data.into())).await {
                        log::error!("{tag} ws_writer: audio send error: {e}");
                        send_err.store(true, Ordering::SeqCst);
                        break;
                    }
                }
                WsCommand::KeepAlive => {
                    if let Some(ref frame) = keepalive {
                        if let Err(e) = write.send(Message::Text(frame.clone().into())).await {
                            log::error!("{tag} ws_writer: keepalive error: {e}");
                            send_err.store(true, Ordering::SeqCst);
                            break;
                        }
                    }
                }
                WsCommand::Close => {
                    let _ = write.send(Message::Text(close_frame.clone().into())).await;
                    let _ = write.close().await;
                    break;
                }
            }
        }
    });

    // Async receiver: parse incoming JSON frames.
    let receiver_event_tx = event_tx.clone();
    let receiver = async {
        while let Some(msg_result) = read.next().await {
            if recv_cancelled.load(Ordering::SeqCst) {
                break;
            }
            match msg_result {
                Ok(Message::Text(text)) => {
                    match provider.parse_message(&text, &receiver_event_tx).await {
                        Ok(true) => break,
                        Ok(false) => {}
                        Err(e) => log::warn!("{tag} receiver: parse error: {e}"),
                    }
                }
                Ok(Message::Close(_)) => {
                    log::info!("{tag} receiver: server closed connection");
                    break;
                }
                Ok(_) => {}
                Err(e) => {
                    log::error!("{tag} receiver: WebSocket error: {e}");
                    recv_err.store(true, Ordering::SeqCst);
                    let _ = receiver_event_tx
                        .send(TranscriptEvent::Error(format!("WebSocket error: {e}")))
                        .await;
                    break;
                }
            }
        }
    };

    let _ = tokio::join!(audio_reader, ws_writer, receiver);

    if send_error_flag.load(Ordering::SeqCst) || recv_error_flag.load(Ordering::SeqCst) {
        return Err(SttError::ConnectionFailed(
            "Connection lost unexpectedly".into(),
        ));
    }

    Ok(())
}
