// src-tauri/crates/notes/src/plan_models.rs
use serde::{Deserialize, Serialize};

/// Distinguishes template plans (reusable) from session-scoped plans.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PlanKind {
    Template,
    Session,
}

impl PlanKind {
    #[must_use]
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Template => "template",
            Self::Session => "session",
        }
    }

    #[must_use]
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "template" => Some(Self::Template),
            "session" => Some(Self::Session),
            _ => None,
        }
    }
}

/// The five item types the plan supports in v1.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlanItemType {
    Verse,
    Song,
    Announcement,
    Section,
    Blank,
}

impl PlanItemType {
    #[must_use]
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Verse => "verse",
            Self::Song => "song",
            Self::Announcement => "announcement",
            Self::Section => "section",
            Self::Blank => "blank",
        }
    }

    #[must_use]
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "verse" => Some(Self::Verse),
            "song" => Some(Self::Song),
            "announcement" => Some(Self::Announcement),
            "section" => Some(Self::Section),
            "blank" => Some(Self::Blank),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateMeta {
    pub id: i64,
    pub name: String,
    pub notes: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub item_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanItem {
    pub id: i64,
    pub plan_id: i64,
    pub plan_kind: PlanKind,
    pub order_index: f64,
    pub item_type: PlanItemType,
    /// Opaque JSON payload whose shape depends on `item_type`. Validated
    /// client-side; stored raw.
    pub item_data: String,
    pub auto_advance_seconds: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub plan_id: i64,
    pub plan_kind: PlanKind,
    pub items: Vec<PlanItem>,
}
