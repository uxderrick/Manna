//! Turning audio into embeddings.
//!
//! CLEWS (exported to ONNX by `research/song-detection/clews_export.py`)
//! takes a batch of fixed 20 s windows at 16 kHz, shape `[B, 320000]`, and
//! returns unit-length 1024-d embeddings. Clips shorter than 20 s are padded
//! by repeating them, exactly as the original model does internally.

use crate::{normalize, Result, SongMatchError, EMBED_DIM, SAMPLE_RATE_HZ, WINDOW_SAMPLES};

/// Anything that maps model windows to embeddings (the ONNX model, or a fake
/// in tests).
pub trait Embedder: Send + Sync {
    /// Embed full-length model windows (each `WINDOW_SAMPLES` long).
    fn embed_windows(&self, windows: &[Vec<f32>]) -> Result<Vec<Vec<f32>>>;
}

/// Repeat `clip` until it is `len` samples long (or cut it to `len`).
pub fn repeat_pad(clip: &[f32], len: usize) -> Vec<f32> {
    if clip.is_empty() {
        return vec![0.0; len];
    }
    clip.iter().copied().cycle().take(len).collect()
}

/// Cut `audio` into clips of `clip_s` seconds every `hop_s` seconds, each
/// padded to one model window. A recording shorter than one clip yields a
/// single (padded) window, matching the research code.
#[expect(clippy::cast_possible_truncation, clippy::cast_sign_loss, reason = "clip and hop are a few seconds")]
pub fn windows(audio: &[f32], clip_s: f32, hop_s: f32) -> Vec<Vec<f32>> {
    let clip = ((clip_s * SAMPLE_RATE_HZ) as usize).max(1);
    let hop = ((hop_s * SAMPLE_RATE_HZ) as usize).max(1);
    let last_start = audio.len().saturating_sub(clip);
    (0..=last_start)
        .step_by(hop)
        .map(|start| {
            let end = (start + clip).min(audio.len());
            repeat_pad(&repeat_pad(&audio[start..end], clip), WINDOW_SAMPLES)
        })
        .collect()
}

/// Embed a live query: the whole clip as one window.
pub fn embed_query(embedder: &dyn Embedder, clip: &[f32]) -> Result<Vec<f32>> {
    let window = repeat_pad(clip, WINDOW_SAMPLES);
    let mut out = embedder.embed_windows(&[window])?;
    out.pop().ok_or_else(|| SongMatchError::Model("no embedding returned".into()))
}

/// Embed a reference recording as 20 s shingles every 10 s (the research
/// setting the benchmarks used).
pub fn embed_reference(embedder: &dyn Embedder, audio: &[f32]) -> Result<Vec<Vec<f32>>> {
    let all = windows(audio, 20.0, 10.0);
    let mut out = Vec::with_capacity(all.len());
    for batch in all.chunks(8) {
        out.extend(embedder.embed_windows(batch)?);
    }
    Ok(out)
}

/// Check size and normalise embeddings coming back from a model.
pub fn finish(mut raw: Vec<f32>, batch: usize) -> Result<Vec<Vec<f32>>> {
    if raw.len() != batch * EMBED_DIM {
        return Err(SongMatchError::Dimension { got: raw.len(), expected: batch * EMBED_DIM });
    }
    Ok(raw
        .chunks_mut(EMBED_DIM)
        .map(|v| {
            normalize(v);
            v.to_vec()
        })
        .collect())
}

#[cfg(feature = "onnx")]
pub use onnx::OnnxEmbedder;

#[cfg(feature = "onnx")]
mod onnx {
    use std::path::Path;
    use std::sync::Mutex;

    use ort::session::Session;
    use ort::value::Tensor;

    use super::{finish, Embedder};
    use crate::{Result, SongMatchError, WINDOW_SAMPLES};

    /// CLEWS through ONNX Runtime (`clews_int8.onnx`, about 208 MB).
    pub struct OnnxEmbedder {
        session: Mutex<Session>,
    }

    impl OnnxEmbedder {
        /// `threads`: intra-op threads; 2 keeps room for speech recognition.
        pub fn load(model_path: &Path, threads: usize) -> Result<Self> {
            let err = |e: ort::Error| SongMatchError::Model(e.to_string());
            let session = Session::builder()
                .map_err(err)?
                .with_optimization_level(ort::session::builder::GraphOptimizationLevel::Level3)
                .map_err(err)?
                .with_intra_threads(threads.max(1))
                .map_err(err)?
                .commit_from_file(model_path)
                .map_err(err)?;
            Ok(Self { session: Mutex::new(session) })
        }
    }

    impl Embedder for OnnxEmbedder {
        fn embed_windows(&self, windows: &[Vec<f32>]) -> Result<Vec<Vec<f32>>> {
            if windows.is_empty() {
                return Ok(Vec::new());
            }
            let err = |e: ort::Error| SongMatchError::Model(e.to_string());
            let mut data = Vec::with_capacity(windows.len() * WINDOW_SAMPLES);
            for w in windows {
                data.extend_from_slice(&super::repeat_pad(w, WINDOW_SAMPLES));
            }
            #[expect(clippy::cast_possible_wrap, reason = "batch sizes are tiny")]
            let shape = vec![windows.len() as i64, WINDOW_SAMPLES as i64];
            let input = Tensor::from_array((shape, data)).map_err(err)?;
            let mut session = self.session.lock().map_err(|e| SongMatchError::Model(e.to_string()))?;
            let outputs = session.run(ort::inputs!["audio" => input]).map_err(err)?;
            let (_, values) = outputs[0usize].try_extract_tensor::<f32>().map_err(err)?;
            finish(values.to_vec(), windows.len())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SAMPLE_RATE;

    #[test]
    fn repeat_pad_cycles_short_clips() {
        assert_eq!(repeat_pad(&[1.0, 2.0, 3.0], 7), [1.0, 2.0, 3.0, 1.0, 2.0, 3.0, 1.0]);
        assert_eq!(repeat_pad(&[1.0, 2.0, 3.0], 2), [1.0, 2.0]);
        assert_eq!(repeat_pad(&[], 3), [0.0; 3]);
    }

    #[test]
    fn reference_windows_follow_the_20s_every_10s_layout() {
        let audio = vec![0.5; 45 * SAMPLE_RATE];
        let w = windows(&audio, 20.0, 10.0);
        assert_eq!(w.len(), 3, "starts at 0, 10 and 20 s");
        assert!(w.iter().all(|x| x.len() == WINDOW_SAMPLES));
        let short = windows(&vec![0.5; 5 * SAMPLE_RATE], 20.0, 10.0);
        assert_eq!(short.len(), 1, "a short recording is one padded window");
    }

    #[test]
    fn finish_checks_size_and_normalises() {
        let out = finish(vec![3.0; 2 * EMBED_DIM], 2).unwrap();
        assert_eq!(out.len(), 2);
        assert!((crate::dot(&out[0], &out[0]) - 1.0).abs() < 1e-4);
        assert!(finish(vec![1.0; 10], 1).is_err());
    }
}
