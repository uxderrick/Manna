use thiserror::Error;

#[derive(Error, Debug)]
pub enum SessionError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("Session not found: {0}")]
    NotFound(i64),

    #[error("Invalid session state transition: {from} -> {to}")]
    InvalidTransition { from: String, to: String },

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, SessionError>;
