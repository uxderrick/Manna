use thiserror::Error;

#[non_exhaustive]
#[derive(Debug, Error)]
pub enum BibleError {
    #[error("database error: {0}")]
    DatabaseError(#[from] rusqlite::Error),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("invalid reference: {0}")]
    InvalidReference(String),

    #[error("could not read file: {0}")]
    Io(#[from] std::io::Error),

    /// The file is not a Bible in a supported format, or is malformed.
    #[error("could not import Bible: {0}")]
    Parse(String),

    /// Imports need a database opened with [`crate::BibleDb::open_with_user`].
    #[error("imported Bibles are unavailable: no user Bible database is open")]
    NoUserStore,
}
