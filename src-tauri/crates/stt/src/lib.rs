//! Speech-to-text integration for the Manna application.
//!
//! Provides real-time transcription via multiple providers:
//! - **Deepgram** (cloud) — WebSocket streaming with keyword boosting
//! - **AssemblyAI** (cloud) — Universal-Streaming with keyterms prompting
//! - **Whisper** (local) — offline inference via whisper.cpp
//!
//! # Key types
//!
//! - [`SttProvider`] — trait for swappable STT backends
//! - [`DeepgramClient`] — Deepgram WebSocket/REST provider
//! - [`AssemblyAIClient`] — AssemblyAI Universal-Streaming provider
//! - [`TranscriptEvent`] — streaming transcript events (partial, final, etc.)
//! - [`SttConfig`] — API configuration
//! - [`SttError`] — error type for STT operations
//!
//! # Feature flags
//!
//! - `rest-fallback` — enables REST API fallback client
//! - `whisper` — enables local Whisper STT provider

pub mod assemblyai;
pub mod deepgram;
pub mod error;
pub mod keyterms;
pub mod provider;
pub mod rest;
pub mod types;
pub mod ws_runtime;

#[cfg(feature = "whisper")]
pub mod whisper;

pub use assemblyai::AssemblyAIClient;
pub use deepgram::DeepgramClient;
pub use error::SttError;
pub use keyterms::{bible_keyterms, priority_keyterms};
pub use provider::SttProvider;
pub use types::{SttConfig, TranscriptEvent, Word};

#[cfg(feature = "whisper")]
pub use whisper::WhisperProvider;
