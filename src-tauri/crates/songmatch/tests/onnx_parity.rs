//! The Rust ONNX path gives the same embeddings as the Python research code.
//!
//! Needs `research/song-detection/export_onnx_parity.py` output in
//! `~/manna-song-data/cache/rust-parity/` and the model it used. On a
//! machine with a current ONNX Runtime:
//!
//! ```text
//! cargo test -p rhema-songmatch --features onnx --test onnx_parity -- --ignored --nocapture
//! ```
//!
//! Elsewhere (Intel Macs), with an older runtime loaded at run time:
//!
//! ```text
//! ORT_DYLIB_PATH=.../onnxruntime/capi/libonnxruntime.1.20.1.dylib \
//!   cargo test -p rhema-songmatch --features onnx-dynamic --test onnx_parity -- --ignored --nocapture
//! ```
#![cfg(feature = "onnx-core")]

use std::path::PathBuf;
use std::time::Instant;

use rhema_songmatch::embedder::{embed_query, embed_reference, OnnxEmbedder};
use rhema_songmatch::{dot, EMBED_DIM};
use serde_json::Value;

fn dir() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap()).join("manna-song-data/cache/rust-parity")
}

fn floats(name: &str) -> Vec<f32> {
    let bytes = std::fs::read(dir().join(name)).unwrap();
    bytes.as_chunks::<4>().0.iter().map(|b| f32::from_le_bytes(*b)).collect()
}

fn json(name: &str) -> Value {
    serde_json::from_str(&std::fs::read_to_string(dir().join(name)).unwrap()).unwrap()
}

#[test]
#[ignore = "needs the CLEWS model and locally dumped Python embeddings"]
fn onnx_matches_python() {
    let meta = json("audio.json");
    let model = PathBuf::from(meta["model"].as_str().unwrap());
    let start = Instant::now();
    let embedder = OnnxEmbedder::load(&model, 2).unwrap();
    println!("model loaded in {:.1} s", start.elapsed().as_secs_f32());

    let audio = floats("audio.f32");
    let expected: Vec<&[f32]> = floats("query.f32").leak().chunks(EMBED_DIM).collect();
    let mut offset = 0;
    for (i, len) in meta["lengths"].as_array().unwrap().iter().enumerate() {
        let len = usize::try_from(len.as_u64().unwrap()).unwrap();
        let clip = &audio[offset..offset + len];
        offset += len;
        let t = Instant::now();
        let got = embed_query(&embedder, clip).unwrap();
        let cos = dot(&got, expected[i]);
        println!("query {i}: {len} samples, cosine to Python {cos:.5}, {:.2} s", t.elapsed().as_secs_f32());
        assert!(cos > 0.999, "query {i} differs from Python (cosine {cos})");
    }

    let reference = floats("reference_audio.f32");
    let expected: Vec<&[f32]> = floats("reference.f32").leak().chunks(EMBED_DIM).collect();
    let windows = usize::try_from(json("reference.json")["windows"].as_u64().unwrap()).unwrap();
    let t = Instant::now();
    let got = embed_reference(&embedder, &reference).unwrap();
    println!("reference: {} windows in {:.2} s", got.len(), t.elapsed().as_secs_f32());
    assert_eq!(got.len(), windows);
    for (i, (g, e)) in got.iter().zip(&expected).enumerate() {
        let cos = dot(g, e);
        assert!(cos > 0.999, "reference window {i} differs from Python (cosine {cos})");
    }
}
