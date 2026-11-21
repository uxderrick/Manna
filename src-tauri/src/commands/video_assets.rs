//! Managed copies of local blank-background videos.
use std::path::Path;

pub(super) async fn copy_video(src: &Path, directory: &Path) -> Result<String, String> {
    use tokio::io::AsyncReadExt;
    let extension = src
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !["mp4", "m4v", "mov", "webm"].contains(&extension.as_str()) {
        return Err("Choose an MP4, M4V, MOV or WebM video.".into());
    }
    let mut source = tokio::fs::File::open(src)
        .await
        .map_err(|_| "The selected video could not be opened.")?;
    let mut header = [0; 12];
    source
        .read_exact(&mut header)
        .await
        .map_err(|_| "This file is not a valid video.")?;
    let iso_video = matches!(&header[4..8], b"ftyp" | b"moov" | b"mdat" | b"wide");
    let webm = header[..4] == [0x1a, 0x45, 0xdf, 0xa3];
    if (extension == "webm" && !webm) || (extension != "webm" && !iso_video) {
        return Err("This file is not a supported video container.".into());
    }
    tokio::fs::create_dir_all(directory)
        .await
        .map_err(|_| "Could not create video storage.")?;
    let dest = directory.join(format!("{}.{}", uuid::Uuid::new_v4(), extension));
    tokio::fs::copy(src, &dest)
        .await
        .map_err(|_| "Could not copy the video into Manna storage.")?;
    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn import_blank_video(src_path: String) -> Result<String, String> {
    let directory = dirs::data_dir()
        .ok_or("App data directory unavailable")?
        .join("com.manna.app")
        .join("blank-videos");
    copy_video(Path::new(&src_path), &directory).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn copies_to_unique_paths_and_preserves_the_previous_video() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("worship.MP4");
        tokio::fs::write(&src, b"\x00\x00\x00\x18ftypisom example")
            .await
            .unwrap();
        let dest = dir.path().join("stored");
        let first = copy_video(&src, &dest).await.unwrap();
        let second = copy_video(&src, &dest).await.unwrap();
        assert_ne!(first, second);
        assert_eq!(
            tokio::fs::read(first).await.unwrap(),
            tokio::fs::read(src).await.unwrap()
        );
        assert!(Path::new(&second).is_file());
    }
    #[tokio::test]
    async fn rejects_missing_files_and_non_video_content_without_touching_existing_files() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["missing.mp4", "bad.txt", "renamed.mp4"] {
            let path = dir.path().join(name);
            if name != "missing.mp4" {
                tokio::fs::write(&path, b"not video").await.unwrap();
            }
            assert!(copy_video(&path, dir.path()).await.is_err());
        }
    }
}
