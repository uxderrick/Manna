use super::provider::CommsClient;
use super::storage::{read_config, write_private};
use super::{now, root, validate_message, SmsRuntime};
use rhema_notes::SessionDb;
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::State;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSms {
    pub id: String,
    pub session_id: i64,
    pub message: String,
    pub sender_id: String,
    pub profile_id: String,
    pub contact_list_id: String,
    pub created_at: u64,
    pub recipient_count: u32,
    pub total_parts: u32,
    pub estimated_cost: f64,
    pub currency: String,
    pub status: String,
    pub provider_id: Option<String>,
    pub total_sent: u32,
    pub total_failed: u32,
    pub delivered: Option<u32>,
    pub error: Option<String>,
}
pub(super) fn normalize_list_id(value: &str) -> Result<String, String> {
    let compact: String = value
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .collect();
    uuid::Uuid::parse_str(&compact)
        .map(|id| id.hyphenated().to_string())
        .map_err(|_| "Enter a valid Comms360 contact list ID.".into())
}
fn file(directory: &Path, session: i64) -> Result<PathBuf, String> {
    if session <= 0 {
        return Err("Invalid SMS session.".into());
    }
    Ok(directory.join(format!("list-send-{session}.json")))
}
fn read(directory: &Path, session: i64) -> Result<Option<ListSms>, String> {
    match std::fs::read(file(directory, session)?) {
        Ok(bytes) => {
            let batch: ListSms = serde_json::from_slice(&bytes).map_err(|_| {
                "Could not read the saved SMS send. Check Comms360 before starting another send."
            })?;
            if batch.session_id != session {
                return Err("The SMS send belongs to another session.".into());
            }
            Ok(Some(batch))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("Could not read the saved SMS send.".into()),
    }
}
fn archive_file(directory: &Path, batch: &ListSms) -> Result<PathBuf, String> {
    if batch.session_id <= 0 || uuid::Uuid::parse_str(&batch.id).is_err() {
        return Err("Invalid saved SMS reference.".into());
    }
    Ok(directory.join(format!("list-send-{}-{}.json", batch.session_id, batch.id)))
}
fn save(directory: &Path, batch: &ListSms) -> Result<(), String> {
    let archive = archive_file(directory, batch)?;
    // Preserve older installations' single send record before replacing the current preview.
    if let Some(previous) = read(directory, batch.session_id)? {
        if previous.id != batch.id {
            write_private(&archive_file(directory, &previous)?, &previous)?;
        }
    }
    write_private(&archive, batch)?;
    write_private(&file(directory, batch.session_id)?, batch)
}
fn ensure_new_preview(
    directory: &Path,
    session: i64,
    previous_send_id: Option<&str>,
) -> Result<(), String> {
    let previous = read(directory, session)?;
    if previous
        .as_ref()
        .is_some_and(|send| send.status == "UNKNOWN")
    {
        return Err("The previous SMS submission is uncertain. Retry its saved submission before starting another message.".into());
    }
    if let Some(expected) = previous_send_id {
        if !previous
            .as_ref()
            .is_some_and(|send| send.id == expected && send.provider_id.is_some())
        {
            return Err(
                "The previous SMS changed. Reopen the SMS window before starting another message."
                    .into(),
            );
        }
    } else if previous.is_some_and(|send| send.provider_id.is_some()) {
        return Err(
            "An SMS send already exists. Use Send another message to prepare a new preview.".into(),
        );
    }
    Ok(())
}
fn matches_profile(batch: &ListSms, profile: &str) -> Result<(), String> {
    if batch.profile_id != profile {
        return Err("Use the original Comms360 key to continue this saved send.".into());
    }
    Ok(())
}
async fn submit(directory: &Path, batch: &mut ListSms, client: &CommsClient) -> Result<(), String> {
    if batch.provider_id.is_some() {
        return Ok(());
    }
    if !matches!(batch.status.as_str(), "PREVIEWED" | "UNKNOWN") {
        return Err("Prepare a new preview after fixing the rejected request.".into());
    }
    if now().saturating_sub(batch.created_at) > 15 * 60 * 1000 {
        return Err("This preview is over 15 minutes old. If submission was uncertain, check Comms360 before trying another send.".into());
    }
    if batch.status == "PREVIEWED" {
        let current = client
            .preview_list(&batch.contact_list_id, &batch.message, &batch.sender_id)
            .await?;
        if current.total_recipients != batch.recipient_count
            || current.total_estimated_cost != batch.estimated_cost
            || current.currency != batch.currency
            || current.total_parts != batch.total_parts
        {
            batch.recipient_count = current.total_recipients;
            batch.estimated_cost = current.total_estimated_cost;
            batch.total_parts = current.total_parts;
            batch.currency = current.currency;
            batch.created_at = now();
            batch.error = Some("The contact list or cost changed. Review the updated preview, then click Send SMS again.".into());
            save(directory, batch)?;
            return Ok(());
        }
    }
    batch.status = "UNKNOWN".into();
    batch.error = None;
    save(directory, batch)?;
    match client
        .send_list(
            &batch.contact_list_id,
            &batch.message,
            &batch.sender_id,
            &batch.id,
        )
        .await
    {
        Ok(accepted) => {
            batch.provider_id = Some(accepted.id);
            batch.status = accepted.status;
        }
        Err(error) => {
            batch.status = if error.uncertain {
                "UNKNOWN"
            } else {
                "REJECTED"
            }
            .into();
            batch.error = Some(error.message);
        }
    }
    save(directory, batch)
}
async fn refresh(
    directory: &Path,
    batch: &mut ListSms,
    client: &CommsClient,
) -> Result<(), String> {
    let Some(id) = &batch.provider_id else {
        return Ok(());
    };
    let progress = client.list_progress(id).await?;
    batch.status = progress.status;
    batch.recipient_count = progress.total_recipients;
    batch.total_sent = progress.total_sent;
    batch.total_failed = progress.total_failed;
    batch.error = None;
    match client.list_delivered(id).await {
        Ok(count) => batch.delivered = Some(count),
        Err(error) => {
            batch.delivered = None;
            batch.error = Some(error);
        }
    }
    save(directory, batch)
}

#[tauri::command]
pub async fn get_contact_list_sms(
    app: tauri::AppHandle,
    runtime: State<'_, SmsRuntime>,
    session_id: i64,
) -> Result<Option<ListSms>, String> {
    let _guard = runtime.0.lock().await;
    read(&root(&app)?, session_id)
}
#[tauri::command]
pub async fn preview_contact_list_sms(
    app: tauri::AppHandle,
    runtime: State<'_, SmsRuntime>,
    db: State<'_, Mutex<SessionDb>>,
    session_id: i64,
    message: String,
    previous_send_id: Option<String>,
) -> Result<ListSms, String> {
    let _guard = runtime.0.lock().await;
    {
        db.lock()
            .map_err(|_| "Session database is busy.")?
            .get_session(session_id)
            .map_err(|_| "This session could not be found.")?;
    }
    validate_message(&message)?;
    let directory = root(&app)?;
    ensure_new_preview(&directory, session_id, previous_send_id.as_deref())?;
    let config = read_config(&directory)?.ok_or("Add Comms360 in Settings → API Keys first.")?;
    let contact_list_id = normalize_list_id(&config.contact_list_id)?;
    let preview = CommsClient::new(&config.key)?
        .preview_list(&contact_list_id, &message, &config.sender_id)
        .await?;
    let batch = ListSms {
        id: uuid::Uuid::new_v4().to_string(),
        session_id,
        message,
        sender_id: config.sender_id,
        profile_id: config.profile_id,
        contact_list_id,
        created_at: now(),
        recipient_count: preview.total_recipients,
        total_parts: preview.total_parts,
        estimated_cost: preview.total_estimated_cost,
        currency: preview.currency,
        status: "PREVIEWED".into(),
        provider_id: None,
        total_sent: 0,
        total_failed: 0,
        delivered: None,
        error: None,
    };
    save(&directory, &batch)?;
    Ok(batch)
}
async fn operate(
    app: tauri::AppHandle,
    runtime: State<'_, SmsRuntime>,
    session: i64,
    id: &str,
    send: bool,
) -> Result<ListSms, String> {
    let _guard = runtime.0.lock().await;
    let directory = root(&app)?;
    let mut batch = read(&directory, session)?.ok_or("Preview the SMS before sending.")?;
    if batch.id != id {
        return Err(
            "This preview was replaced. Reopen the SMS window to review the current one.".into(),
        );
    }
    let config = read_config(&directory)?.ok_or("Add Comms360 in Settings → API Keys first.")?;
    matches_profile(&batch, &config.profile_id)?;
    let client = CommsClient::new(&config.key)?;
    if send {
        submit(&directory, &mut batch, &client).await?;
    } else {
        refresh(&directory, &mut batch, &client).await?;
    }
    Ok(batch)
}
#[tauri::command]
pub async fn send_contact_list_sms(
    app: tauri::AppHandle,
    runtime: State<'_, SmsRuntime>,
    session_id: i64,
    send_id: String,
) -> Result<ListSms, String> {
    operate(app, runtime, session_id, &send_id, true).await
}
#[tauri::command]
pub async fn refresh_contact_list_sms(
    app: tauri::AppHandle,
    runtime: State<'_, SmsRuntime>,
    session_id: i64,
    send_id: String,
) -> Result<ListSms, String> {
    operate(app, runtime, session_id, &send_id, false).await
}

#[cfg(test)]
mod tests;
