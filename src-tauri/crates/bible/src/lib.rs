//! Bible database access for the Rhema application.
//!
//! Provides SQLite-backed storage and retrieval for Bible translations,
//! books, verses, and cross-references. Supports full-text search via
//! FTS5 and bulk verse loading for quotation matching indexes.
//!
//! # Key types
//!
//! - [`BibleDb`] — connection wrapper for the `SQLite` database
//! - [`Verse`], [`Book`], [`Translation`] — data models
//! - [`BibleError`] — error type for all database operations
//! - [`parse_bible_file`] / [`BibleDb::import_bible`] — import Bibles from
//!   other worship software into a writable user database

pub mod models;
pub mod error;
pub mod db;
pub mod lookup;
pub mod search;
pub mod crossref;
pub mod import;
pub mod user_store;

pub use models::*;
pub use error::*;
pub use db::*;
pub use import::{parse_bible_file, BibleFormat, ParsedBible, ParsedBook, ParsedVerse};
pub use user_store::{
    is_user_translation, is_user_verse, BibleImportReport, BibleImportStatus, UserBibleStore,
};
