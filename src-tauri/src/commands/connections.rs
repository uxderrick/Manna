use serde::Serialize;
use std::path::Path;
use tauri::Manager;

#[derive(Default, Serialize)]
pub struct ConnectionStatus {
    publishing: bool,
    sms: bool,
}

fn status_at(directory: &Path) -> ConnectionStatus {
    let read = |path: &Path| {
        std::fs::read(path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
    };
    let publishing = read(&directory.join("sermon-publishing.json")).is_some_and(|value| {
        matches!(
            value["url"].as_str(),
            Some("https://sermon.ewcadentan.com" | "https://sermon.ewcadenta.com")
        ) && value["key"]
            .as_str()
            .is_some_and(|key| key.trim().len() >= 32)
    });
    let sms = read(&directory.join("sms/config.json")).is_some_and(|value| {
        ["key", "senderId", "profileId"].iter().all(|key| {
            value[key]
                .as_str()
                .is_some_and(|text| !text.trim().is_empty())
        })
    });
    ConnectionStatus { publishing, sms }
}

#[tauri::command]
pub fn get_church_connections(app: tauri::AppHandle) -> Result<ConnectionStatus, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|_| "Could not open connection settings.")?;
    Ok(status_at(&directory))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fresh_and_malformed_settings_disable_connections() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!status_at(dir.path()).publishing);
        assert!(!status_at(dir.path()).sms);
        std::fs::write(dir.path().join("sermon-publishing.json"), b"{bad").unwrap();
        assert!(!status_at(dir.path()).publishing);
    }
    #[test]
    fn existing_ewc_connections_are_detected_independently_without_exposing_keys() {
        let dir = tempfile::tempdir().unwrap();
        let key = "x".repeat(40);
        std::fs::write(
            dir.path().join("sermon-publishing.json"),
            serde_json::to_vec(
                &serde_json::json!({"url":"https://sermon.ewcadentan.com", "key":key}),
            )
            .unwrap(),
        )
        .unwrap();
        let status = status_at(dir.path());
        assert!(status.publishing);
        assert!(!status.sms);
        std::fs::create_dir(dir.path().join("sms")).unwrap();
        std::fs::write(dir.path().join("sms/config.json"), serde_json::to_vec(&serde_json::json!({"key":key,"senderId":"EWC","profileId":"test","contactListId":""})).unwrap()).unwrap();
        let status = status_at(dir.path());
        assert!(status.sms);
        assert_eq!(
            serde_json::to_value(status).unwrap(),
            serde_json::json!({"publishing":true,"sms":true})
        );
    }
    #[test]
    fn unsupported_sites_and_incomplete_sms_settings_remain_disabled() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("sermon-publishing.json"),
            serde_json::to_vec(
                &serde_json::json!({"url":"https://example.org", "key":"x".repeat(40)}),
            )
            .unwrap(),
        )
        .unwrap();
        std::fs::create_dir(dir.path().join("sms")).unwrap();
        std::fs::write(
            dir.path().join("sms/config.json"),
            b"{\"key\":\"\",\"senderId\":\"EWC\"}",
        )
        .unwrap();
        assert!(!status_at(dir.path()).publishing);
        assert!(!status_at(dir.path()).sms);
    }
}
