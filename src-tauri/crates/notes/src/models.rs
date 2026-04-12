use serde::{Deserialize, Serialize};

/// Status of a sermon session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionStatus {
    Planned,
    Live,
    Completed,
}

impl SessionStatus {
    #[must_use]
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Planned => "planned",
            Self::Live => "live",
            Self::Completed => "completed",
        }
    }

    /// Parse a status string. Returns `None` for unrecognised values.
    #[must_use]
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "planned" => Some(Self::Planned),
            "live" => Some(Self::Live),
            "completed" => Some(Self::Completed),
            _ => None,
        }
    }
}

/// A planned scripture reference attached to a session before it starts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedScripture {
    pub verse_ref: String,
    pub translation: String,
    pub order: i32,
}

/// Full sermon session record.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SermonSession {
    pub id: i64,
    pub title: String,
    pub speaker: Option<String>,
    pub date: String,
    pub series_name: Option<String>,
    pub tags: Vec<String>,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub status: SessionStatus,
    pub planned_scriptures: Vec<PlannedScripture>,
    pub summary: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Request payload for creating a new session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionRequest {
    pub title: String,
    pub speaker: Option<String>,
    pub date: String,
    pub series_name: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub planned_scriptures: Vec<PlannedScripture>,
}

/// A verse detection recorded during a live session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetection {
    pub id: i64,
    pub session_id: i64,
    pub verse_ref: String,
    pub verse_text: String,
    pub translation: String,
    pub confidence: f64,
    pub source: String,
    pub detected_at: String,
    pub was_presented: bool,
    pub transcript_snippet: Option<String>,
}

/// A transcript segment captured during a live session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTranscriptSegment {
    pub id: i64,
    pub session_id: i64,
    pub text: String,
    pub is_final: bool,
    pub confidence: f64,
    pub timestamp_ms: i64,
    pub speaker_label: Option<String>,
}

/// A user note attached to a session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionNote {
    pub id: i64,
    pub session_id: i64,
    pub note_type: String,
    pub content: String,
    pub created_at: String,
}

/// Request payload for adding a note to a session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddNoteRequest {
    pub session_id: i64,
    pub note_type: String,
    pub content: String,
}

/// Request payload for recording a verse detection.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddDetectionRequest {
    pub session_id: i64,
    pub verse_ref: String,
    pub verse_text: String,
    pub translation: String,
    pub confidence: f64,
    pub source: String,
    pub transcript_snippet: Option<String>,
}

/// Request payload for adding a transcript segment.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddTranscriptRequest {
    pub session_id: i64,
    pub text: String,
    pub is_final: bool,
    pub confidence: f64,
    pub timestamp_ms: i64,
    pub speaker_label: Option<String>,
}
