//! Bound remote image memory use before any library file is written.
const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;

pub(super) async fn read_image(response: reqwest::Response) -> Result<Vec<u8>, String> {
    read_bounded(response, MAX_IMAGE_BYTES).await
}

async fn read_bounded(mut response: reqwest::Response, limit: usize) -> Result<Vec<u8>, String> {
    if !response.status().is_success() {
        return Err(format!("Download failed: HTTP {}", response.status()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err("Image exceeds the 20 MB download limit".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Image download interrupted")?
    {
        if chunk.len() > limit.saturating_sub(bytes.len()) {
            return Err("Image exceeds the 20 MB download limit".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.is_empty() {
        return Err("Image download was empty".into());
    }
    Ok(bytes)
}

pub(super) fn image_extension(bytes: &[u8]) -> Result<&'static str, String> {
    let kind = infer::get(bytes).ok_or("Download is not a supported image")?;
    if !kind.mime_type().starts_with("image/") || !super::IMAGE_EXTS.contains(&kind.extension()) {
        return Err("Download is not a supported image".into());
    }
    Ok(kind.extension())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    async fn response(reply: &'static [u8]) -> reqwest::Response {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0; 2048];
            let _ = stream.read(&mut request).await;
            stream.write_all(reply).await.unwrap();
        });
        reqwest::get(format!("http://{address}/image"))
            .await
            .unwrap()
    }

    #[test]
    fn rejects_non_images_and_uses_content_not_a_misleading_extension() {
        assert!(image_extension(b"<html>not an image</html>").is_err());
        assert!(image_extension(b"<svg onload='alert(1)'></svg>").is_err());
        assert_eq!(image_extension(b"\x89PNG\r\n\x1a\n").unwrap(), "png");
        assert_eq!(image_extension(b"\xff\xd8\xff\xe0").unwrap(), "jpg");
    }

    #[tokio::test]
    async fn bounds_declared_and_chunked_responses_and_accepts_small_images() {
        let declared = response(b"HTTP/1.1 200 OK\r\nContent-Length: 999\r\n\r\n").await;
        assert!(read_bounded(declared, 8).await.is_err());
        let chunked = response(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\n12345\r\n5\r\n67890\r\n0\r\n\r\n").await;
        assert!(read_bounded(chunked, 8).await.is_err());
        let small =
            response(b"HTTP/1.1 200 OK\r\nContent-Length: 8\r\n\r\n\x89PNG\r\n\x1a\n").await;
        assert_eq!(read_bounded(small, 8).await.unwrap(), b"\x89PNG\r\n\x1a\n");
        let empty = response(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n").await;
        assert!(read_bounded(empty, 8).await.is_err());
    }
}
