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
    /// Return `None` if auth is carried in the URL (e.g. `?token=...` query param).
    fn auth_header(&self) -> Result<Option<HeaderValue>, SttError>;

    /// Keepalive frame to send during silence gaps. `None` disables keepalive.
    fn keepalive_frame(&self) -> Option<String>;

    /// Final text frame sent before closing (e.g. `{"type":"CloseStream"}`).
    fn close_frame(&self) -> String;

    /// AssemblyAI confirms that its session is usable with a Begin frame.
    /// A WebSocket upgrade alone is not a speech-session readiness signal.
    fn requires_session_begin(&self) -> bool {
        false
    }

    /// PCM rate for providers that require real-time audio delivery.
    fn realtime_sample_rate(&self) -> Option<u32> {
        None
    }

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
    let audio_closed = Arc::new(AtomicBool::new(false));

    loop {
        if cancelled.load(Ordering::SeqCst) {
            log::info!("{tag}: cancelled, stopping connection loop");
            break;
        }

        match try_connect(
            provider,
            audio_rx.clone(),
            event_tx.clone(),
            cancelled.clone(),
            audio_closed.clone(),
        )
        .await
        {
            Ok(()) => {
                if cancelled.load(Ordering::SeqCst) {
                    log::info!("{tag}: connection closed normally (cancelled)");
                    break;
                }
                if audio_closed.load(Ordering::SeqCst) {
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
                if cancelled.load(Ordering::SeqCst) || audio_closed.load(Ordering::SeqCst) {
                    break;
                }
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

type SpeechSocket = tokio_tungstenite::WebSocketStream<crate::connection_warmup::SpeechStream>;
type UpgradeResponse = tokio_tungstenite::tungstenite::handshake::client::Response;

async fn connect_session(
    request: tokio_tungstenite::tungstenite::handshake::client::Request,
    prepared: Option<crate::connection_warmup::SpeechStream>,
) -> Result<(SpeechSocket, UpgradeResponse, bool), SttError> {
    let (mut socket, response, reused) = connect_request(request.clone(), prepared).await?;
    match wait_for_session_begin(&mut socket).await {
        Ok(()) => Ok((socket, response, reused)),
        Err(error) if reused => {
            log::warn!("Prepared speech transport upgraded but session was not ready: {error}; retrying fresh");
            drop(socket);
            let (mut socket, response, _) = connect_request(request, None).await?;
            wait_for_session_begin(&mut socket).await?;
            Ok((socket, response, false))
        }
        Err(error) => Err(error),
    }
}

async fn wait_for_session_begin(socket: &mut SpeechSocket) -> Result<(), SttError> {
    tokio::time::timeout(Duration::from_secs(5), async {
        while let Some(frame) = socket.next().await {
            match frame
                .map_err(|_| SttError::ConnectionFailed("Speech session read failed".into()))?
            {
                Message::Text(text) => {
                    let json: serde_json::Value = serde_json::from_str(&text).map_err(|_| {
                        SttError::ParseError("Invalid speech session response".into())
                    })?;
                    if json["type"] == "Begin" {
                        log::info!("Speech session Begin received; ready for audio");
                        return Ok(());
                    }
                    if json.get("error").is_some() || json["type"] == "Termination" {
                        return Err(SttError::ConnectionFailed(
                            "Speech server rejected the session".into(),
                        ));
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
        Err(SttError::ConnectionFailed(
            "Speech connection closed before session Begin".into(),
        ))
    })
    .await
    .map_err(|_| SttError::ConnectionFailed("Speech session Begin timed out".into()))?
}

async fn connect_request(
    request: tokio_tungstenite::tungstenite::handshake::client::Request,
    prepared: Option<crate::connection_warmup::SpeechStream>,
) -> Result<(SpeechSocket, UpgradeResponse, bool), SttError> {
    if let Some(stream) = prepared {
        match tokio::time::timeout(
            Duration::from_secs(3),
            tokio_tungstenite::client_async(request.clone(), stream),
        )
        .await
        {
            Ok(Ok((socket, response))) => return Ok((socket, response, true)),
            _ => log::info!(
                "Prepared speech connection expired at server; retrying a fresh connection"
            ),
        }
    }
    let (socket, response) = tokio_tungstenite::connect_async(request)
        .await
        .map_err(|e| SttError::ConnectionFailed(e.to_string()))?;
    Ok((socket, response, false))
}

async fn try_connect<P: WsProvider>(
    provider: &P,
    audio_rx: Receiver<Vec<i16>>,
    event_tx: mpsc::Sender<TranscriptEvent>,
    cancelled: Arc<AtomicBool>,
    audio_closed: Arc<AtomicBool>,
) -> Result<(), SttError> {
    let tag = provider.log_tag();
    let realtime_rate = provider.realtime_sample_rate();
    if realtime_rate == Some(0) {
        return Err(SttError::ConnectionFailed(
            "Audio sample rate must be positive".into(),
        ));
    }
    let url = provider.build_url()?;

    let mut request = url
        .as_str()
        .into_client_request()
        .map_err(|e| SttError::ConnectionFailed(e.to_string()))?;
    if let Some(auth) = provider.auth_header()? {
        request.headers_mut().insert("Authorization", auth);
    }

    let started = std::time::Instant::now();
    let prepared = crate::connection_warmup::take(url.host_str().unwrap_or_default()).await;
    let (ws_stream, response, reused) = if provider.requires_session_begin() {
        connect_session(request, prepared).await?
    } else {
        connect_request(request, prepared).await?
    };
    log::info!(
        "{tag}: connected (HTTP {}), elapsed_ms={}, prepared_connection={reused}",
        response.status(),
        started.elapsed().as_millis()
    );
    let _ = event_tx.send(TranscriptEvent::Connected).await;

    let (mut write, mut read) = ws_stream.split();

    let connection_ended = Arc::new(AtomicBool::new(false));
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
    // Keep AssemblyAI's outbound queue near one second, rather than 16 seconds.
    let capacity = if realtime_rate.is_some() { 4 } else { 64 };
    let (ws_tx, mut ws_rx) = tokio::sync::mpsc::channel::<WsCommand>(capacity);
    let batch_samples = realtime_rate.map_or(BATCH_SAMPLES, |rate| (rate / 10).max(1) as usize);
    let min_batch_bytes = realtime_rate.map_or(0, |rate| (rate / 20).max(1) as usize * 2);

    // Blocking audio reader: crossbeam → tokio channel.
    let audio_reader = {
        let ws_tx = ws_tx.clone();
        let cancelled = send_cancelled.clone();
        let send_keepalive = keepalive.is_some();
        let connection_ended = connection_ended.clone();
        tokio::task::spawn_blocking(move || {
            let mut batch_buf: Vec<u8> = Vec::with_capacity(batch_samples * 2);
            let batch_byte_threshold = batch_samples * 2;
            let mut last_send = std::time::Instant::now();
            let keepalive_interval = Duration::from_secs(5);

            'capture: loop {
                if connection_ended.load(Ordering::SeqCst) {
                    break;
                }
                if cancelled.load(Ordering::SeqCst) {
                    let _ = ws_tx.blocking_send(WsCommand::Close);
                    break;
                }

                match audio_rx.recv_timeout(Duration::from_millis(50)) {
                    Ok(samples) => {
                        for sample in &samples {
                            batch_buf.extend_from_slice(&sample.to_le_bytes());
                        }
                        while batch_buf.len() >= batch_byte_threshold {
                            let remainder = batch_buf.split_off(batch_byte_threshold);
                            let data = std::mem::replace(&mut batch_buf, remainder);
                            if ws_tx.blocking_send(WsCommand::Audio(data)).is_err() {
                                break 'capture;
                            }
                            last_send = std::time::Instant::now();
                        }
                    }
                    Err(crossbeam_channel::RecvTimeoutError::Timeout) => {
                        if !batch_buf.is_empty() && batch_buf.len() >= min_batch_bytes {
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
                        audio_closed.store(true, Ordering::SeqCst);
                        if !batch_buf.is_empty() {
                            // Preserve the final words; pad only a sub-50ms tail with silence.
                            if batch_buf.len() < min_batch_bytes {
                                batch_buf.resize(min_batch_bytes, 0);
                            }
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
    let writer_cancelled = cancelled.clone();
    let mut ws_writer = tokio::spawn(async move {
        let mut sent_audio = false;
        let mut next_audio_at = tokio::time::Instant::now();
        while let Some(cmd) = ws_rx.recv().await {
            match cmd {
                WsCommand::Audio(data) => {
                    if realtime_rate.is_some() {
                        tokio::time::sleep_until(next_audio_at).await;
                        if writer_cancelled.load(Ordering::SeqCst) {
                            let _ = write.send(Message::Text(close_frame.clone().into())).await;
                            let _ = write.close().await;
                            break;
                        }
                    }
                    let samples = data.len() / 2;
                    if let Err(e) = write.send(Message::Binary(data.into())).await {
                        log::error!("{tag} ws_writer: audio send error: {e}");
                        send_err.store(true, Ordering::SeqCst);
                        break;
                    }
                    if let Some(rate) = realtime_rate {
                        // Anchor to the actual send, so a stall never earns catch-up credit.
                        next_audio_at = tokio::time::Instant::now()
                            + Duration::from_micros(samples as u64 * 1_000_000 / u64::from(rate));
                    }
                    if !sent_audio {
                        log::info!("{tag}: first audio batch sent");
                        sent_audio = true;
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
                Ok(Message::Close(frame)) => {
                    match frame {
                        Some(f) => log::warn!(
                            "{tag} receiver: server closed connection (code={}, reason={:?})",
                            u16::from(f.code),
                            f.reason
                        ),
                        None => log::info!("{tag} receiver: server closed connection (no frame)"),
                    }
                    break;
                }
                Ok(_) => {}
                Err(e) => {
                    log::error!("{tag} receiver: WebSocket error: {e}");
                    recv_err.store(true, Ordering::SeqCst);
                    // A transport loss is recoverable; run_stream owns retry/fatal events.
                    break;
                }
            }
        }
    };

    tokio::pin!(receiver);
    let writer_finished = tokio::select! {
        () = &mut receiver => {
            // Stop this connection's reader before reconnecting. Otherwise it
            // waits forever for microphone audio and can steal the next run's frames.
            connection_ended.store(true, Ordering::SeqCst);
            ws_writer.abort();
            false
        }
        _ = &mut ws_writer => {
            connection_ended.store(true, Ordering::SeqCst);
            // On stop/source closure allow final replies, but never wait forever
            // for a server that does not acknowledge the close frame.
            let _ = tokio::time::timeout(Duration::from_secs(1), &mut receiver).await;
            true
        }
    };
    connection_ended.store(true, Ordering::SeqCst);
    if !writer_finished {
        let _ = ws_writer.await;
    }
    let _ = audio_reader.await;

    if send_error_flag.load(Ordering::SeqCst) || recv_error_flag.load(Ordering::SeqCst) {
        return Err(SttError::ConnectionFailed(
            "Connection lost unexpectedly".into(),
        ));
    }

    Ok(())
}

#[cfg(test)]
mod prepared_connection_tests {
    use super::*;
    use tokio::net::TcpListener;
    struct LocalAssemblyAI {
        url: String,
        client: crate::AssemblyAIClient,
    }
    impl WsProvider for LocalAssemblyAI {
        fn log_tag(&self) -> &'static str {
            "LocalAssemblyAI"
        }
        fn build_url(&self) -> Result<Url, SttError> {
            Ok(Url::parse(&self.url).unwrap())
        }
        fn auth_header(&self) -> Result<Option<HeaderValue>, SttError> {
            Ok(None)
        }
        fn keepalive_frame(&self) -> Option<String> {
            None
        }
        fn close_frame(&self) -> String {
            self.client.close_frame()
        }
        fn requires_session_begin(&self) -> bool {
            true
        }
        fn realtime_sample_rate(&self) -> Option<u32> {
            self.client.realtime_sample_rate()
        }
        fn parse_message<'a>(
            &'a self,
            text: &'a str,
            tx: &'a mpsc::Sender<TranscriptEvent>,
        ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<bool, SttError>> + Send + 'a>>
        {
            self.client.parse_message(text, tx)
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn live_audio_reaches_provider_before_two_hundred_ms() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let provider = LocalAssemblyAI {
            url: format!("ws://{}/", listener.local_addr().unwrap()),
            client: crate::AssemblyAIClient::new(crate::SttConfig::default()),
        };
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(async move {
            let (tcp, _) = listener.accept().await.unwrap();
            let mut socket = tokio_tungstenite::accept_async(tcp).await.unwrap();
            socket
                .send(Message::Text(r#"{"type":"Begin"}"#.into()))
                .await
                .unwrap();
            ready_tx.send(()).unwrap();
            let start = tokio::time::Instant::now();
            let mut first = None;
            while let Some(Ok(message)) = socket.next().await {
                match message {
                    Message::Binary(_) => {
                        first.get_or_insert(start.elapsed());
                    }
                    Message::Text(_) => {
                        let _ = socket
                            .send(Message::Text(r#"{"type":"Termination"}"#.into()))
                            .await;
                    }
                    Message::Close(_) => break,
                    _ => {}
                }
            }
            first.unwrap()
        });
        let (tx, rx) = crossbeam_channel::unbounded();
        let producer = tokio::spawn(async move {
            ready_rx.await.unwrap();
            for _ in 0..20 {
                tx.send(vec![100; 320]).unwrap();
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        });
        let (events, _rx) = mpsc::channel(16);
        try_connect(
            &provider,
            rx,
            events,
            Arc::new(AtomicBool::new(false)),
            Arc::new(AtomicBool::new(false)),
        )
        .await
        .unwrap();
        producer.await.unwrap();
        let first = server.await.unwrap();
        assert!(
            first < Duration::from_millis(200),
            "First live audio waited {first:?}"
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn assemblyai_buffered_audio_is_paced_and_uses_valid_chunks() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let provider = LocalAssemblyAI {
            url: format!("ws://{}/", listener.local_addr().unwrap()),
            client: crate::AssemblyAIClient::new(crate::SttConfig::default()),
        };
        let server = tokio::spawn(async move {
            let (tcp, _) = listener.accept().await.unwrap();
            let mut socket = tokio_tungstenite::accept_async(tcp).await.unwrap();
            socket
                .send(Message::Text(r#"{"type":"Begin"}"#.into()))
                .await
                .unwrap();
            let start = tokio::time::Instant::now();
            let mut frames = Vec::new();
            while let Some(Ok(message)) = socket.next().await {
                match message {
                    Message::Binary(bytes) => frames.push((bytes.len() / 2, start.elapsed())),
                    Message::Text(_) => {
                        let _ = socket
                            .send(Message::Text(r#"{"type":"Termination"}"#.into()))
                            .await;
                    }
                    Message::Close(_) => {
                        let _ = socket.close(None).await;
                        break;
                    }
                    _ => {}
                }
            }
            frames
        });
        let (tx, rx) = crossbeam_channel::unbounded();
        // Deliberately backlogged audio, including a callback larger than 1s.
        tx.send(vec![100; 32_000]).unwrap();
        tx.send(vec![100; 16_000]).unwrap();
        drop(tx);
        let (events, _rx) = mpsc::channel(16);
        tokio::time::timeout(
            Duration::from_secs(8),
            try_connect(
                &provider,
                rx,
                events,
                Arc::new(AtomicBool::new(false)),
                Arc::new(AtomicBool::new(false)),
            ),
        )
        .await
        .unwrap()
        .unwrap();
        let frames = server.await.unwrap();
        assert_eq!(frames.iter().map(|(n, _)| n).sum::<usize>(), 48_000);
        assert!(
            frames.iter().all(|(n, _)| (800..=16_000).contains(n)),
            "Each chunk must be 50–1000ms: {frames:?}"
        );
        assert!(
            frames.last().unwrap().1 >= Duration::from_millis(2_500),
            "Backlogged audio must not be sent in a burst: {frames:?}"
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn assemblyai_reconnect_resumes_transcripts_without_bursting() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let provider = LocalAssemblyAI {
            url: format!("ws://{}/", listener.local_addr().unwrap()),
            client: crate::AssemblyAIClient::new(crate::SttConfig::default()),
        };
        let server = tokio::spawn(async move {
            let (tcp, _) = listener.accept().await.unwrap();
            let mut first = tokio_tungstenite::accept_async(tcp).await.unwrap();
            first
                .send(Message::Text(r#"{"type":"Begin"}"#.into()))
                .await
                .unwrap();
            assert!(matches!(first.next().await, Some(Ok(Message::Binary(_)))));
            first.close(None).await.unwrap();
            drop(first);
            let (tcp, _) = listener.accept().await.unwrap();
            let mut second = tokio_tungstenite::accept_async(tcp).await.unwrap();
            second
                .send(Message::Text(r#"{"type":"Begin"}"#.into()))
                .await
                .unwrap();
            let mut times = Vec::new();
            let start = tokio::time::Instant::now();
            while let Some(Ok(message)) = second.next().await {
                match message {
                    Message::Binary(bytes) => {
                        times.push((bytes.len() / 2, start.elapsed()));
                        if times.len() == 3 {
                            second.send(Message::Text(r#"{"type":"Turn","transcript":"Resumed test speech","end_of_turn":true}"#.into())).await.unwrap();
                        }
                    }
                    Message::Text(_) => {
                        let _ = second
                            .send(Message::Text(r#"{"type":"Termination"}"#.into()))
                            .await;
                    }
                    Message::Close(_) => {
                        let _ = second.close(None).await;
                        break;
                    }
                    _ => {}
                }
            }
            times
        });
        let (tx, rx) = crossbeam_channel::bounded(64);
        let cancelled = Arc::new(AtomicBool::new(false));
        let stop = cancelled.clone();
        let producer = tokio::spawn(async move {
            while !stop.load(Ordering::SeqCst) {
                if tx.try_send(vec![100; 4_000]).is_err() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
        });
        let (events, mut event_rx) = mpsc::channel(32);
        let worker = tokio::spawn({
            let cancelled = cancelled.clone();
            async move { run_stream(&provider, false, rx, events, cancelled).await }
        });
        let mut connections = 0;
        let mut reconnects = 0;
        tokio::time::timeout(Duration::from_secs(8), async {
            while let Some(event) = event_rx.recv().await {
                match event {
                    TranscriptEvent::Connected => connections += 1,
                    TranscriptEvent::Reconnecting => reconnects += 1,
                    TranscriptEvent::Final { transcript, .. }
                        if transcript == "Resumed test speech" =>
                    {
                        return
                    }
                    TranscriptEvent::Error(error) => panic!("Unexpected fatal error: {error}"),
                    _ => {}
                }
            }
            panic!("Transcript channel ended before recovery");
        })
        .await
        .unwrap();
        cancelled.store(true, Ordering::SeqCst);
        producer.await.unwrap();
        tokio::time::timeout(Duration::from_secs(3), worker)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let times = server.await.unwrap();
        assert_eq!(connections, 2);
        assert!(reconnects >= 1);
        let audio_before_third = times[..2].iter().map(|(samples, _)| samples).sum::<usize>();
        let minimum = Duration::from_secs_f64(audio_before_third as f64 / 16_000.0);
        assert!(times[2].1.saturating_sub(times[0].1) + Duration::from_millis(20) >= minimum);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn assemblyai_short_tail_is_preserved_in_one_valid_final_chunk() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let provider = LocalAssemblyAI {
            url: format!("ws://{}/", listener.local_addr().unwrap()),
            client: crate::AssemblyAIClient::new(crate::SttConfig::default()),
        };
        let server = tokio::spawn(async move {
            let (tcp, _) = listener.accept().await.unwrap();
            let mut socket = tokio_tungstenite::accept_async(tcp).await.unwrap();
            socket
                .send(Message::Text(r#"{"type":"Begin"}"#.into()))
                .await
                .unwrap();
            let mut frames = Vec::new();
            while let Some(Ok(message)) = socket.next().await {
                match message {
                    Message::Binary(bytes) => frames.push(bytes),
                    Message::Text(_) => {
                        let _ = socket
                            .send(Message::Text(r#"{"type":"Termination"}"#.into()))
                            .await;
                    }
                    Message::Close(_) => {
                        let _ = socket.close(None).await;
                        break;
                    }
                    _ => {}
                }
            }
            frames
        });
        let (tx, rx) = crossbeam_channel::unbounded();
        let producer = tokio::spawn(async move {
            tx.send(vec![100; 160]).unwrap();
            tokio::time::sleep(Duration::from_millis(150)).await;
            tx.send(vec![100; 160]).unwrap();
        });
        let (events, _rx) = mpsc::channel(16);
        try_connect(
            &provider,
            rx,
            events,
            Arc::new(AtomicBool::new(false)),
            Arc::new(AtomicBool::new(false)),
        )
        .await
        .unwrap();
        producer.await.unwrap();
        let frames = server.await.unwrap();
        assert_eq!(frames.len(), 1);
        let samples: Vec<i16> = frames[0]
            .chunks_exact(2)
            .map(|b| i16::from_le_bytes([b[0], b[1]]))
            .collect();
        assert_eq!(samples.len(), 800);
        assert_eq!(&samples[..320], &[100; 320]);
        assert!(samples[320..].iter().all(|s| *s == 0));
    }

    #[tokio::test]
    async fn fresh_session_without_begin_returns_a_timeout() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (tcp, _) = listener.accept().await.unwrap();
            let _socket = tokio_tungstenite::accept_async(tcp).await.unwrap();
            std::future::pending::<()>().await;
        });
        let request = format!("ws://{addr}/").into_client_request().unwrap();
        let result =
            tokio::time::timeout(Duration::from_secs(7), connect_session(request, None)).await;
        assert!(
            matches!(result, Ok(Err(SttError::ConnectionFailed(ref message))) if message.contains("Begin timed out"))
        );
        server.abort();
    }

    #[tokio::test]
    async fn rejected_session_does_not_report_readiness() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (tcp, _) = listener.accept().await.unwrap();
            let mut socket = tokio_tungstenite::accept_async(tcp).await.unwrap();
            socket
                .send(Message::Text(r#"{"error":"session rejected"}"#.into()))
                .await
                .unwrap();
        });
        let request = format!("ws://{addr}/").into_client_request().unwrap();
        let result = connect_session(request, None).await;
        assert!(
            matches!(result, Err(SttError::ConnectionFailed(ref message)) if message.contains("rejected"))
        );
        server.await.unwrap();
    }
    #[tokio::test]
    async fn silent_prepared_session_reconnects_before_delivering_transcripts() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let tcp = tokio::net::TcpStream::connect(addr).await.unwrap();
        let server = tokio::spawn(async move {
            let (tcp, _) = listener.accept().await.unwrap();
            let _silent = tokio_tungstenite::accept_async(tcp).await.unwrap();
            let (tcp, _) = listener.accept().await.unwrap();
            let mut fresh = tokio_tungstenite::accept_async(tcp).await.unwrap();
            fresh
                .send(Message::Text(r#"{"type":"Begin"}"#.into()))
                .await
                .unwrap();
            fresh
                .send(Message::Text(
                    r#"{"type":"Turn","transcript":"For God so loved the world"}"#.into(),
                ))
                .await
                .unwrap();
        });
        let request = format!("ws://{addr}/").into_client_request().unwrap();
        let (mut socket, _, reused) =
            connect_session(request, Some(tokio_tungstenite::MaybeTlsStream::Plain(tcp)))
                .await
                .unwrap();
        let message = tokio::time::timeout(Duration::from_secs(7), socket.next()).await;
        assert!(
            matches!(message, Ok(Some(Ok(Message::Text(ref text)))) if text.contains("For God so loved the world")),
            "A successful upgrade without Begin must recover instead of silently waiting"
        );
        assert!(!reused);
        server.await.unwrap();
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    #[ignore = "sends generated speech to AssemblyAI; requires key and MANNA_TEST_PCM"]
    async fn live_runtime_transcribes_generated_speech() {
        use crate::SttProvider;
        struct ProbeLogger;
        impl log::Log for ProbeLogger {
            fn enabled(&self, _: &log::Metadata<'_>) -> bool {
                true
            }
            fn log(&self, record: &log::Record<'_>) {
                let message = record.args().to_string();
                if record.target().ends_with("ws_runtime")
                    || message.starts_with("[AssemblyAI] recv")
                {
                    println!("{}", message);
                }
            }
            fn flush(&self) {}
        }
        static LOGGER: ProbeLogger = ProbeLogger;
        let _ = log::set_logger(&LOGGER);
        log::set_max_level(log::LevelFilter::Info);
        let bytes = std::fs::read(std::env::var("MANNA_TEST_PCM").unwrap()).unwrap();
        let samples: Vec<i16> = bytes
            .chunks_exact(2)
            .map(|b| i16::from_le_bytes([b[0], b[1]]))
            .collect();
        assert!(
            samples.len() > 16000 && samples.iter().any(|sample| sample.abs() > 1000),
            "Generated speech fixture is empty or silent"
        );
        for prepared in [false, true] {
            let provider = Arc::new(crate::AssemblyAIClient::new(crate::SttConfig {
                api_key: std::env::var("ASSEMBLYAI_API_KEY").expect("API key required"),
                ..Default::default()
            }));
            if prepared {
                crate::connection_warmup::prepare("assemblyai")
                    .await
                    .unwrap();
                tokio::time::sleep(Duration::from_secs(3)).await;
            }
            let (audio_tx, audio_rx) = crossbeam_channel::bounded(64);
            let (event_tx, mut event_rx) = mpsc::channel(64);
            let runner = provider.clone();
            let task = tokio::spawn(async move { runner.start(audio_rx, event_tx).await });
            assert!(matches!(
                tokio::time::timeout(Duration::from_secs(15), event_rx.recv()).await,
                Ok(Some(TranscriptEvent::Connected))
            ));
            let speech = samples.clone();
            let sender = tokio::spawn(async move {
                for chunk in speech.chunks(4000) {
                    audio_tx.send(chunk.to_vec()).unwrap();
                    tokio::time::sleep(Duration::from_millis(250)).await;
                }
                for _ in 0..16 {
                    audio_tx.send(vec![0; 4000]).unwrap();
                    tokio::time::sleep(Duration::from_millis(250)).await;
                }
                audio_tx
            });
            let transcript = tokio::time::timeout(Duration::from_secs(25), async {
                while let Some(event) = event_rx.recv().await {
                    if let TranscriptEvent::Final { transcript, .. } = event {
                        return transcript.to_lowercase().contains("god");
                    }
                }
                false
            })
            .await
            .unwrap_or(false);
            println!("runtime prepared={prepared}, expected_transcript_received={transcript}");
            provider.stop();
            sender.abort();
            let _ = tokio::time::timeout(Duration::from_secs(3), task).await;
            assert!(
                transcript,
                "Runtime failed to transcribe; prepared={prepared}"
            );
        }
    }
    #[tokio::test]
    async fn websocket_upgrade_reuses_prepared_transport() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (tcp, _) = listener.accept().await.unwrap();
            let _socket = tokio_tungstenite::accept_async(tcp).await.unwrap();
        });
        let tcp = tokio::net::TcpStream::connect(addr).await.unwrap();
        let request = format!("ws://{addr}/").into_client_request().unwrap();
        let (_, _, reused) =
            connect_request(request, Some(tokio_tungstenite::MaybeTlsStream::Plain(tcp)))
                .await
                .unwrap();
        assert!(reused);
        server.await.unwrap();
    }
    #[tokio::test]
    async fn closed_prepared_transport_falls_back_to_a_fresh_connection() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let tcp = tokio::net::TcpStream::connect(addr).await.unwrap();
        let (stale, _) = listener.accept().await.unwrap();
        drop(stale);
        let server = tokio::spawn(async move {
            let (fresh, _) = listener.accept().await.unwrap();
            let _socket = tokio_tungstenite::accept_async(fresh).await.unwrap();
        });
        let request = format!("ws://{addr}/").into_client_request().unwrap();
        let (_, _, reused) =
            connect_request(request, Some(tokio_tungstenite::MaybeTlsStream::Plain(tcp)))
                .await
                .unwrap();
        assert!(!reused);
        server.await.unwrap();
    }
    #[tokio::test]
    async fn unresponsive_prepared_transport_times_out_and_reconnects() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let tcp = tokio::net::TcpStream::connect(addr).await.unwrap();
        let (stalled, _) = listener.accept().await.unwrap();
        let server = tokio::spawn(async move {
            let (fresh, _) = listener.accept().await.unwrap();
            let _socket = tokio_tungstenite::accept_async(fresh).await.unwrap();
            drop(stalled);
        });
        let request = format!("ws://{addr}/").into_client_request().unwrap();
        let (_, _, reused) =
            connect_request(request, Some(tokio_tungstenite::MaybeTlsStream::Plain(tcp)))
                .await
                .unwrap();
        assert!(!reused);
        server.await.unwrap();
    }
}
