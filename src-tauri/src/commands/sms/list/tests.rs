use super::*;
use crate::commands::sms::tests::mock_server;

fn sample() -> ListSms {
    ListSms {
        id: uuid::Uuid::new_v4().to_string(),
        session_id: 42,
        message: "Walk by faith.".into(),
        sender_id: "EWC ADENTAN".into(),
        profile_id: "profile".into(),
        contact_list_id: "11111111-2222-4333-8444-555555555555".into(),
        created_at: super::super::now(),
        recipient_count: 1,
        total_parts: 1,
        estimated_cost: 0.05,
        currency: "CREDITS".into(),
        status: "PREVIEWED".into(),
        provider_id: None,
        total_sent: 0,
        total_failed: 0,
        delivered: None,
        error: None,
    }
}

#[tokio::test]
async fn preview_uses_list_id_and_parses_the_live_cost_shape() {
    let (base, requests) = mock_server(vec![(200, r#"{"success":true,"data":{"totalRecipients":1,"totalMessages":1,"totalParts":1,"totalEstimatedCost":"0.0500","currency":"CREDITS"}}"#)]).await;
    let sample = sample();
    let preview = CommsClient::with_base("local-test-key", base)
        .preview_list(&sample.contact_list_id, &sample.message, &sample.sender_id)
        .await
        .unwrap();
    assert_eq!(preview.total_recipients, 1);
    assert_eq!(preview.total_estimated_cost, 0.05);
    let requests = requests.await.unwrap();
    assert!(requests[0].starts_with("POST /campaigns/sms/preview "));
    assert!(requests[0].contains(&sample.contact_list_id));
    assert!(!requests[0].contains("\"recipients\""));
}

#[tokio::test]
async fn retry_reuses_saved_payload_and_accepted_send_is_never_repeated() {
    let (base, requests) = mock_server(vec![
        (200, r#"{"success":true,"data":{"totalRecipients":1,"totalParts":1,"totalEstimatedCost":"0.05","currency":"CREDITS"}}"#),
        (500, r#"{"success":false}"#),
        (202, r#"{"success":true,"data":{"campaignId":"send_1","status":"QUEUED","totalRecipients":1}}"#),
    ]).await;
    let dir = tempfile::tempdir().unwrap();
    let client = CommsClient::with_base("local-test-key", base);
    let mut batch = sample();
    submit(dir.path(), &mut batch, &client).await.unwrap();
    assert_eq!(batch.status, "UNKNOWN");
    let mut recovered = read(dir.path(), 42).unwrap().unwrap();
    submit(dir.path(), &mut recovered, &client).await.unwrap();
    submit(dir.path(), &mut recovered, &client).await.unwrap();
    assert_eq!(recovered.provider_id.as_deref(), Some("send_1"));
    let requests = requests.await.unwrap();
    let key = format!("idempotency-key: {}", batch.id);
    assert!(requests[1..]
        .iter()
        .all(|request| request.to_lowercase().contains(&key)));
    assert_eq!(
        requests[1].split("\r\n\r\n").nth(1),
        requests[2].split("\r\n\r\n").nth(1)
    );
}

#[tokio::test]
async fn changed_list_size_requires_a_new_review_without_sending() {
    let (base, requests) = mock_server(vec![(200, r#"{"success":true,"data":{"totalRecipients":2,"totalParts":2,"totalEstimatedCost":"0.10","currency":"CREDITS"}}"#)]).await;
    let dir = tempfile::tempdir().unwrap();
    let mut batch = sample();
    submit(
        dir.path(),
        &mut batch,
        &CommsClient::with_base("local-test-key", base),
    )
    .await
    .unwrap();
    assert_eq!(batch.status, "PREVIEWED");
    assert_eq!(batch.recipient_count, 2);
    assert!(batch.error.as_deref().unwrap().contains("changed"));
    assert_eq!(requests.await.unwrap().len(), 1);
}

#[tokio::test]
async fn completed_processing_does_not_imply_delivery() {
    let (base, requests) = mock_server(vec![
        (200, r#"{"success":true,"data":{"id":"send_1","status":"COMPLETED","totalRecipients":1,"totalSent":1,"totalFailed":0}}"#),
        (200, r#"{"success":true,"data":[],"pagination":{"total":0}}"#),
    ]).await;
    let dir = tempfile::tempdir().unwrap();
    let mut batch = sample();
    batch.provider_id = Some("send_1".into());
    refresh(
        dir.path(),
        &mut batch,
        &CommsClient::with_base("local-test-key", base),
    )
    .await
    .unwrap();
    assert_eq!(batch.total_sent, 1);
    assert_eq!(batch.delivered, Some(0));
    assert_eq!(batch.status, "COMPLETED");
    assert!(requests
        .await
        .unwrap()
        .iter()
        .all(|request| request.starts_with("GET ")));
}

#[test]
fn saved_list_send_cannot_be_replaced_or_used_for_another_session() {
    let dir = tempfile::tempdir().unwrap();
    let mut batch = sample();
    batch.provider_id = Some("send_1".into());
    save(dir.path(), &batch).unwrap();
    assert!(ensure_new_preview(dir.path(), 42, None).is_err());
    assert!(read(dir.path(), 43).unwrap().is_none());
    assert_eq!(
        normalize_list_id("11111111 2222 4333 8444 555555555555").unwrap(),
        batch.contact_list_id
    );
}

#[test]
fn existing_settings_keep_the_saved_key_without_an_embedded_contact_list() {
    let config: super::super::storage::SmsConfig = serde_json::from_str(
        r#"{"key":"local-test-key","senderId":"EWC ADENTAN","profileId":"profile"}"#,
    )
    .unwrap();
    assert!(config.contact_list_id.is_empty());
    assert_eq!(config.key, "local-test-key");
}

#[tokio::test]
async fn stale_preview_never_calls_the_provider() {
    let (base, requests) = mock_server(vec![]).await;
    let dir = tempfile::tempdir().unwrap();
    let mut batch = sample();
    batch.created_at = super::super::now() - 16 * 60 * 1000;
    assert!(submit(
        dir.path(),
        &mut batch,
        &CommsClient::with_base("local-test-key", base)
    )
    .await
    .is_err());
    assert!(requests.await.unwrap().is_empty());
}

#[tokio::test]
#[ignore = "Requires saved Comms360 settings; previews a list and reads an existing test only"]
async fn live_list_preview_and_existing_progress_are_read_only() {
    let directory = dirs::data_dir().unwrap().join("com.manna.app").join("sms");
    let config = read_config(&directory)
        .unwrap()
        .expect("Save Comms360 settings first");
    let client = CommsClient::new(&config.key).unwrap();
    let preview = client
        .preview_list(
            &config.contact_list_id,
            "Connection preview only. No SMS will be sent.",
            &config.sender_id,
        )
        .await
        .unwrap();
    assert!(preview.total_recipients > 0);
    let previous = directory.join(format!("contact-list-test-{}.json", config.contact_list_id));
    if previous.exists() {
        let record: serde_json::Value =
            serde_json::from_slice(&std::fs::read(previous).unwrap()).unwrap();
        let id = record["campaignId"].as_str().unwrap();
        let progress = client.list_progress(id).await.unwrap();
        assert_eq!(progress.id, id);
        assert!(client.list_delivered(id).await.unwrap() <= progress.total_recipients);
    }
}

#[test]
fn another_preview_preserves_the_previous_send_record() {
    let dir = tempfile::tempdir().unwrap();
    let mut first = sample();
    first.provider_id = Some("first-campaign".into());
    first.status = "COMPLETED".into();
    // An existing installation may have only the old single-record file.
    write_private(&file(dir.path(), 42).unwrap(), &first).unwrap();
    let mut second = sample();
    second.message = "A different follow-up message.".into();
    save(dir.path(), &second).unwrap();
    let archived: ListSms = serde_json::from_slice(
        &std::fs::read(dir.path().join(format!("list-send-42-{}.json", first.id))).unwrap(),
    )
    .unwrap();
    assert_eq!(archived.provider_id.as_deref(), Some("first-campaign"));
    assert_eq!(archived.message, first.message);
    assert_eq!(read(dir.path(), 42).unwrap().unwrap().id, second.id);
    assert_ne!(first.id, second.id);
}

#[test]
fn another_send_requires_explicit_current_reference_and_never_bypasses_uncertainty() {
    let dir = tempfile::tempdir().unwrap();
    let mut accepted = sample();
    accepted.provider_id = Some("first-send".into());
    accepted.status = "QUEUED".into();
    save(dir.path(), &accepted).unwrap();
    assert!(ensure_new_preview(dir.path(), 42, None).is_err());
    assert!(ensure_new_preview(dir.path(), 42, Some("outdated-reference")).is_err());
    assert!(ensure_new_preview(dir.path(), 42, Some(&accepted.id)).is_ok());
    accepted.status = "UNKNOWN".into();
    save(dir.path(), &accepted).unwrap();
    assert!(ensure_new_preview(dir.path(), 42, Some(&accepted.id)).is_err());
    accepted.provider_id = None;
    save(dir.path(), &accepted).unwrap();
    assert!(ensure_new_preview(dir.path(), 42, Some(&accepted.id)).is_err());
    assert!(ensure_new_preview(dir.path(), 42, None).is_err());
}

#[tokio::test]
async fn intentional_second_send_gets_a_new_key_and_retries_do_not_send_again() {
    let (base, requests) = mock_server(vec![
        (200, r#"{"success":true,"data":{"totalRecipients":1,"totalParts":1,"totalEstimatedCost":"0.05","currency":"CREDITS"}}"#),
        (202, r#"{"success":true,"data":{"campaignId":"first-send","status":"QUEUED","totalRecipients":1}}"#),
        (200, r#"{"success":true,"data":{"totalRecipients":1,"totalParts":1,"totalEstimatedCost":"0.05","currency":"CREDITS"}}"#),
        (202, r#"{"success":true,"data":{"campaignId":"second-send","status":"QUEUED","totalRecipients":1}}"#),
    ]).await;
    let dir = tempfile::tempdir().unwrap();
    let client = CommsClient::with_base("local-test-key", base);
    let mut first = sample();
    submit(dir.path(), &mut first, &client).await.unwrap();
    ensure_new_preview(dir.path(), 42, Some(&first.id)).unwrap();
    let mut second = sample();
    second.message = "The second deliberate message.".into();
    save(dir.path(), &second).unwrap();
    assert!(ensure_new_preview(dir.path(), 42, Some(&first.id)).is_err());
    submit(dir.path(), &mut second, &client).await.unwrap();
    let mut recovered = read(dir.path(), 42).unwrap().unwrap();
    submit(dir.path(), &mut recovered, &client).await.unwrap();
    let requests = requests.await.unwrap();
    assert_eq!(requests.len(), 4);
    assert!(requests[1]
        .to_lowercase()
        .contains(&format!("idempotency-key: {}", first.id)));
    assert!(requests[3]
        .to_lowercase()
        .contains(&format!("idempotency-key: {}", second.id)));
    assert_ne!(first.id, second.id);
    assert_eq!(recovered.provider_id.as_deref(), Some("second-send"));
    let preserved: ListSms =
        serde_json::from_slice(&std::fs::read(archive_file(dir.path(), &first).unwrap()).unwrap())
            .unwrap();
    assert_eq!(preserved.provider_id.as_deref(), Some("first-send"));
}

#[test]
fn invalid_archive_reference_cannot_escape_private_storage() {
    let dir = tempfile::tempdir().unwrap();
    let mut batch = sample();
    batch.id = "../outside".into();
    assert!(save(dir.path(), &batch).is_err());
    assert!(read(dir.path(), 42).unwrap().is_none());
}
