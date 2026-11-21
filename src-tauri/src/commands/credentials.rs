//! Provider secrets live in the OS credential store, never in JSON settings.
use tauri::Manager;

const NAMES: [&str; 8] = [
    "deepgramApiKey",
    "assemblyAiApiKey",
    "claudeApiKey",
    "deepseekApiKey",
    "geniusToken",
    "pexelsApiKey",
    "unsplashApiKey",
    "braveApiKey",
];

fn authorize(window_label: &str, name: &str) -> Result<(), String> {
    if window_label != "main" || !NAMES.contains(&name) {
        return Err("Credential access is not allowed".into());
    }
    Ok(())
}

fn entry(service: &str, name: &str) -> Result<keyring::Entry, String> {
    if !cfg!(any(target_os = "macos", target_os = "windows")) {
        return Err("Secure key storage is not available on this platform".into());
    }
    keyring::Entry::new(service, name).map_err(|_| "Could not open secure key storage".into())
}

fn read(entry: &keyring::Entry) -> Result<Option<String>, String> {
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("Could not read secure key storage. Unlock it and try again.".into()),
    }
}

fn write(entry: &keyring::Entry, value: Option<String>) -> Result<(), String> {
    if let Some(value) = value.filter(|value| !value.is_empty()) {
        entry
            .set_password(&value)
            .map_err(|_| "Could not save key in secure storage".to_string())?;
        if read(entry)?.as_deref() != Some(value.as_str()) {
            return Err("Secure key storage verification failed".into());
        }
    } else {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(_) => return Err("Could not remove key from secure storage".into()),
        }
        if read(entry)?.is_some() {
            return Err("Secure key removal verification failed".into());
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn get_provider_credential(
    window: tauri::WebviewWindow,
    name: String,
) -> Result<Option<String>, String> {
    authorize(window.label(), &name)?;
    let service = window.app_handle().config().identifier.clone();
    tauri::async_runtime::spawn_blocking(move || read(&entry(&service, &name)?))
        .await
        .map_err(|_| "Secure key storage task failed".to_string())?
}

#[tauri::command]
pub async fn set_provider_credential(
    window: tauri::WebviewWindow,
    name: String,
    value: Option<String>,
) -> Result<(), String> {
    authorize(window.label(), &name)?;
    let service = window.app_handle().config().identifier.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let entry = entry(&service, &name)?;
        write(&entry, value)
    })
    .await
    .map_err(|_| "Secure key storage task failed".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    #[test]
    #[ignore = "uses a unique temporary item in the real OS credential store"]
    fn synthetic_os_store_round_trip() {
        let service = format!("com.manna.security-test.{}", uuid::Uuid::new_v4());
        let entry = entry(&service, "synthetic-key").unwrap();
        let result = (|| {
            write(&entry, Some("generated-test-value".into()))?;
            if read(&entry)?.as_deref() != Some("generated-test-value") {
                return Err("Temporary credential did not round-trip".to_string());
            }
            write(&entry, None)
        })();
        let _ = entry.delete_credential();
        result.unwrap();
    }

    #[test]
    fn writes_reads_and_removes_keys_without_touching_the_os_store() {
        let entry =
            keyring::Entry::new_with_credential(Box::<keyring::mock::MockCredential>::default());
        assert_eq!(read(&entry).unwrap(), None);
        write(&entry, Some("synthetic-key".into())).unwrap();
        assert_eq!(read(&entry).unwrap().as_deref(), Some("synthetic-key"));
        let mock = entry
            .get_credential()
            .downcast_ref::<keyring::mock::MockCredential>()
            .unwrap();
        mock.set_error(keyring::Error::NoStorageAccess(Box::new(
            std::io::Error::other("locked"),
        )));
        assert!(write(&entry, Some("replacement".into())).is_err());
        assert_eq!(read(&entry).unwrap().as_deref(), Some("synthetic-key"));
        write(&entry, None).unwrap();
        assert_eq!(read(&entry).unwrap(), None);
        write(&entry, None).unwrap();
    }

    #[test]
    fn restricts_credentials_to_main_window_and_known_names() {
        for name in NAMES {
            assert!(authorize("main", name).is_ok());
        }
        assert!(authorize("broadcast", "deepgramApiKey").is_err());
        assert!(authorize("main", "other-service").is_err());
    }
}
