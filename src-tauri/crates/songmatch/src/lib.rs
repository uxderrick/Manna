//! Song matching by sound.
//!
//! Recognises which song is being sung or played, whoever performs it, by
//! comparing CLEWS cover-song embeddings (Sony, MIT) of the live audio with
//! reference recordings of each song. See `docs/song-detection/` for the
//! design and the benchmarks this follows.
//!
//! - [`buffer::AudioBuffer`] keeps the last seconds of 16 kHz audio.
//! - [`embedder`] cuts audio into 20 s model windows and embeds them; the
//!   ONNX implementation needs the `onnx` feature.
//! - [`library::Library`] holds each song's references (shipped library,
//!   operator-added, learned from confirmed services) and scores a query.
//! - [`policy`] turns scores into "keep listening", a top-3 suggestion, or a
//!   confident commit.
//! - [`listener::Matcher`] ties them together for live audio: checks every
//!   2 s, resets on silence, and learns from confirmed songs.
//! - [`lyrics::LyricsIndex`] finds songs from the live transcript (the words
//!   being sung), with no recordings needed.

pub mod buffer;
pub mod embedder;
pub mod library;
pub mod listener;
pub mod lyrics;
pub mod policy;

/// Audio sample rate the model expects (and Manna captures at).
pub const SAMPLE_RATE: usize = 16_000;
/// [`SAMPLE_RATE`] as a float, for converting seconds to samples.
pub const SAMPLE_RATE_HZ: f32 = 16_000.0;
/// The model's fixed window: 20 s. Shorter clips are repeat-padded.
pub const WINDOW_SAMPLES: usize = 20 * SAMPLE_RATE;
/// Embedding size of the CLEWS model.
pub const EMBED_DIM: usize = 1024;

#[derive(Debug, thiserror::Error)]
pub enum SongMatchError {
    #[error("model: {0}")]
    Model(String),
    #[error("embedding has {got} values, expected {expected}")]
    Dimension { got: usize, expected: usize },
}

pub type Result<T> = std::result::Result<T, SongMatchError>;

/// Scale a vector to unit length (no-op for an all-zero vector).
pub fn normalize(v: &mut [f32]) {
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 1e-9 {
        for x in v.iter_mut() {
            *x /= norm;
        }
    }
}

/// Dot product; equals cosine similarity for unit vectors.
pub fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}
