//! Optional device-local artwork. Public bundles never include this pack.
use std::{collections::BTreeMap, path::Path};
use tauri::Manager;
const FILES: &[&str] = &[
    "EWC-White.png",
    "MOMO111.png",
    "service-slides/momo.png",
    "service-slides/ewc-adenta-welcome.png",
    "service-slides/welcome-motion.png",
    "service-slides/closing-pastor-motion.png",
    "service-slides/jesus-motion.png",
    "service-slides/jesus-atmosphere.png",
    "service-slides/pastor-john-kennedy.png",
    "service-slides/pastor-john-kennedy-starburst.png",
];
fn list_at(directory: &Path) -> BTreeMap<String, String> {
    FILES
        .iter()
        .filter_map(|name| {
            let path = directory.join(name);
            path.is_file()
                .then(|| (format!("/{name}"), path.to_string_lossy().into_owned()))
        })
        .collect()
}
fn import_at(source: &Path, destination: &Path) -> Result<BTreeMap<String, String>, String> {
    if !source.is_dir() {
        return Err("Choose the church artwork folder.".into());
    }
    let mut found = false;
    for name in FILES {
        let src = source.join(name);
        let Ok(metadata) = std::fs::symlink_metadata(&src) else {
            continue;
        };
        if !metadata.file_type().is_file() || metadata.len() > 30_000_000 {
            continue;
        }
        let dest = destination.join(name);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|_| "Could not create the church artwork folder.")?;
        }
        // Import missing files only: never overwrite artwork used by a live slide.
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&dest)
        {
            Ok(mut output) => {
                let copied = std::fs::File::open(&src)
                    .and_then(|mut input| std::io::copy(&mut input, &mut output));
                if copied.is_err() {
                    let _ = std::fs::remove_file(&dest);
                    return Err("Could not preserve church artwork.".into());
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(_) => return Err("Could not preserve church artwork.".into()),
        }
        found = true;
    }
    if !found {
        return Err("This folder contains no supported church artwork.".into());
    }
    Ok(list_at(destination))
}
#[tauri::command]
pub fn get_private_church_assets(
    app: tauri::AppHandle,
) -> Result<BTreeMap<String, String>, String> {
    let destination = app
        .path()
        .app_data_dir()
        .map_err(|_| "Could not open church artwork.")?
        .join("church-assets");
    // Development migration only. No private folder is compiled into a release.
    #[cfg(debug_assertions)]
    {
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../.private-church-assets");
        if source.is_dir() {
            import_at(&source, &destination)?;
        }
    }
    Ok(list_at(&destination))
}
#[tauri::command]
pub fn import_private_church_assets(
    app: tauri::AppHandle,
    source: String,
) -> Result<usize, String> {
    let destination = app
        .path()
        .app_data_dir()
        .map_err(|_| "Could not open church artwork.")?
        .join("church-assets");
    Ok(import_at(Path::new(&source), &destination)?.len())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fresh_install_has_no_private_assets() {
        let dir = tempfile::tempdir().unwrap();
        assert!(list_at(dir.path()).is_empty());
    }
    #[test]
    fn import_preserves_historical_keys_and_never_overwrites_existing_files() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        std::fs::create_dir(src.path().join("service-slides")).unwrap();
        std::fs::write(src.path().join("service-slides/momo.png"), b"original").unwrap();
        std::fs::write(src.path().join("config.json"), b"not artwork").unwrap();
        let assets = import_at(src.path(), dst.path()).unwrap();
        assert!(assets.contains_key("/service-slides/momo.png"));
        assert_eq!(assets.len(), 1);
        std::fs::write(src.path().join("service-slides/momo.png"), b"replacement").unwrap();
        import_at(src.path(), dst.path()).unwrap();
        assert_eq!(
            std::fs::read(dst.path().join("service-slides/momo.png")).unwrap(),
            b"original"
        );
        assert!(!dst.path().join("config.json").exists());
    }
    #[test]
    fn empty_pack_is_rejected_without_importing_arbitrary_files() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        std::fs::write(src.path().join("other.png"), b"other").unwrap();
        assert!(import_at(src.path(), dst.path()).is_err());
        assert!(list_at(dst.path()).is_empty());
    }
}
