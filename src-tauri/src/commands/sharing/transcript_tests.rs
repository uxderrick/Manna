use super::*;

#[test]
fn recap_uses_original_transcript_as_data_without_a_summary() {
    let transcript = "Can we be honest? It's an unseen burden.\nSet your mind. This one is deliberate.\nI'll do well. The Lord is with me.";
    let prompt = sharing_prompt(transcript, "The Battle in the Mind", Some("Pastor")).unwrap();
    let data: serde_json::Value = serde_json::from_str(prompt.lines().last().unwrap()).unwrap();
    assert_eq!(data["transcript"], transcript);
    assert!(data.get("summary").is_none());
    assert_eq!(data["session_title"], "The Battle in the Mind");
    assert_eq!(data["speaker"], "Pastor");
}

#[test]
fn empty_or_oversized_transcripts_are_rejected_without_silent_truncation() {
    assert!(sharing_prompt(" \n ", "Sunday", None).is_err());
    assert!(sharing_prompt(&"x".repeat(120_001), "Sunday", None).is_err());
}

#[test]
fn source_uses_final_lines_in_order_and_never_changes_saved_content() {
    let directory = tempfile::tempdir().unwrap();
    let db = SessionDb::open(&directory.path().join("sessions.db")).unwrap();
    let request = serde_json::from_value(serde_json::json!({
        "title":"The Battle in the Mind", "date":"2026-10-25"
    }))
    .unwrap();
    let session = db.create_session(&request).unwrap();
    db.update_session_summary(session.id, "A rewritten summary is not the voice source.")
        .unwrap();
    let saved = SharingDraft {
        title: "Saved title".into(),
        recap: "Original saved recap".into(),
        sms: "Original SMS".into(),
    };
    db.save_sharing_draft(session.id, &saved).unwrap();
    for (text, timestamp_ms, is_final) in [
        ("Set your mind. This one is deliberate.", 2000, true),
        ("Can we be honest?", 1000, true),
        ("unfinished live text", 3000, false),
        ("  ", 4000, true),
    ] {
        db.add_transcript(&rhema_notes::AddTranscriptRequest {
            session_id: session.id,
            text: text.into(),
            is_final,
            confidence: 0.9,
            timestamp_ms,
            speaker_label: None,
        })
        .unwrap();
    }
    let transcript = sharing_transcript(&db, session.id).unwrap();
    assert_eq!(
        transcript,
        "Can we be honest?\nSet your mind. This one is deliberate."
    );
    let prompt = sharing_prompt(&transcript, &session.title, None).unwrap();
    assert!(!prompt.contains("A rewritten summary is not the voice source."));
    assert_eq!(
        db.get_sharing_draft(session.id).unwrap().unwrap().recap,
        saved.recap
    );
    assert_eq!(db.get_session_transcript(session.id).unwrap().len(), 4);
    assert_eq!(
        db.get_session(session.id).unwrap().summary.as_deref(),
        Some("A rewritten summary is not the voice source.")
    );
    assert!(sharing_transcript(&db, session.id + 100).is_err());
}
