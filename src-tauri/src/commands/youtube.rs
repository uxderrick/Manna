//! Static, loopback-only wrapper for YouTube's official embedded player.
//! An HTTP origin supplies the referrer missing from packaged custom-scheme pages.
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{OnceCell, Semaphore};

const PLAYER: &str = include_str!("youtube-player.html");
static PORT: OnceCell<u16> = OnceCell::const_new();

async fn serve_connection(mut socket: TcpStream) -> std::io::Result<()> {
    let mut request = Vec::new();
    let mut chunk = [0; 1024];
    loop {
        let count = socket.read(&mut chunk).await?;
        if count == 0 || request.len() + count > 8192 {
            return Ok(());
        }
        request.extend_from_slice(&chunk[..count]);
        if request.windows(4).any(|part| part == b"\r\n\r\n") {
            break;
        }
    }
    let request = String::from_utf8_lossy(&request);
    let mut line = request
        .lines()
        .next()
        .unwrap_or_default()
        .split_whitespace();
    let method = line.next().unwrap_or_default();
    let route = line
        .next()
        .unwrap_or_default()
        .split('?')
        .next()
        .unwrap_or_default();
    let (status, body) = if method == "GET" && route == "/youtube-player.html" {
        ("200 OK", PLAYER)
    } else {
        ("404 Not Found", "Not found")
    };
    let response = format!("HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: strict-origin-when-cross-origin\r\nContent-Security-Policy: default-src 'none'; script-src 'unsafe-inline' https://www.youtube.com https://s.ytimg.com; style-src 'unsafe-inline'; frame-src https://www.youtube.com; frame-ancestors tauri://localhost http://tauri.localhost https://tauri.localhost http://localhost:* http://127.0.0.1:*\r\n\r\n{body}", body.len());
    socket.write_all(response.as_bytes()).await?;
    socket.shutdown().await
}

async fn start_player_server() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Could not start YouTube player: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let connections = Arc::new(Semaphore::new(16));
    tauri::async_runtime::spawn(async move {
        while let Ok((socket, _)) = listener.accept().await {
            let Ok(permit) = Arc::clone(&connections).try_acquire_owned() else {
                continue;
            };
            tauri::async_runtime::spawn(async move {
                let _permit = permit;
                let _ =
                    tokio::time::timeout(Duration::from_secs(3), serve_connection(socket)).await;
            });
        }
    });
    Ok(port)
}

#[tauri::command]
pub async fn youtube_player_url() -> Result<String, String> {
    let port = PORT.get_or_try_init(start_player_server).await?;
    Ok(format!("http://127.0.0.1:{port}/youtube-player.html"))
}

/// Query only the calling output window; a hidden player must not produce audio.
#[tauri::command]
pub fn youtube_output_visible(window: tauri::WebviewWindow) -> Result<bool, String> {
    Ok(window.is_visible().map_err(|e| e.to_string())?
        && !window.is_minimized().map_err(|e| e.to_string())?)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn serves_only_the_static_player_from_a_loopback_address() {
        let port = start_player_server().await.unwrap();
        let base = format!("http://127.0.0.1:{port}");
        let client = reqwest::Client::new();
        let response = client
            .get(format!("{base}/youtube-player.html?video=M7lc1UVf-VE"))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(
            response.headers()["referrer-policy"],
            "strict-origin-when-cross-origin"
        );
        assert_eq!(response.text().await.unwrap(), PLAYER);
        assert_eq!(
            client
                .get(format!("{base}/etc/passwd"))
                .send()
                .await
                .unwrap()
                .status(),
            404
        );
        assert_eq!(
            client
                .post(format!("{base}/youtube-player.html"))
                .send()
                .await
                .unwrap()
                .status(),
            404
        );
    }
}
