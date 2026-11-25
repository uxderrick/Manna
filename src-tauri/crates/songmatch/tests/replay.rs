//! Replays the research live-listening test through the Rust engine.
//!
//! Needs real CLEWS embeddings dumped by
//! `research/song-detection/export_rust_replay.py` into
//! `~/manna-song-data/cache/rust-replay/` (never committed: derived from
//! copyrighted recordings). Run with:
//!
//! ```text
//! cargo test -p rhema-songmatch --test replay -- --ignored --nocapture
//! ```

use std::collections::HashMap;
use std::path::PathBuf;

use rhema_songmatch::library::{Library, Reference, Source};
use rhema_songmatch::policy::{decide, Decision, PolicyConfig};
use rhema_songmatch::EMBED_DIM;
use serde_json::Value;

fn dir() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap()).join("manna-song-data/cache/rust-replay")
}

fn read_f32(name: &str) -> Vec<Vec<f32>> {
    let bytes = std::fs::read(dir().join(name)).unwrap();
    let floats: Vec<f32> = bytes.as_chunks::<4>().0.iter().map(|b| f32::from_le_bytes(*b)).collect();
    floats.chunks(EMBED_DIM).map(<[f32]>::to_vec).collect()
}

fn read_json(name: &str) -> Value {
    serde_json::from_str(&std::fs::read_to_string(dir().join(name)).unwrap()).unwrap()
}

fn strings(v: &Value) -> Vec<String> {
    v.as_array().unwrap().iter().map(|s| s.as_str().unwrap().to_string()).collect()
}

/// First commit over a stream's checkpoints: (seconds, song).
fn first_commit(lib: &Library, queries: &[Vec<f32>], checkpoints: &[f32], plan: &[String]) -> Option<(f32, String)> {
    let mut cfg = PolicyConfig::default();
    if let Some(m) = std::env::var("REPLAY_MARGIN").ok().and_then(|m| m.parse().ok()) {
        cfg.margin = m;
    }
    queries.iter().zip(checkpoints).find_map(|(q, &t)| match decide(&lib.score(q), t, plan, &cfg) {
        Decision::Commit { candidate } => Some((t, candidate.song_id)),
        _ => None,
    })
}

#[test]
#[ignore = "needs locally dumped CLEWS embeddings"]
fn replay_research_streams() {
    let refs = read_json("refs.json");
    let mut vecs = read_f32("refs.f32").into_iter();
    let mut all_refs = Vec::new();
    for r in refs.as_array().unwrap() {
        let count = usize::try_from(r["count"].as_u64().unwrap()).unwrap();
        all_refs.push(Reference {
            id: r["id"].as_str().unwrap().into(),
            song_id: r["song"].as_str().unwrap().into(),
            source: Source::Library,
            embeddings: vecs.by_ref().take(count).collect(),
        });
    }
    let library_without = |excluded: Option<&str>| {
        let mut lib = Library::new();
        for r in all_refs.iter().filter(|r| Some(r.song_id.as_str()) != excluded) {
            lib.add(r.clone());
        }
        lib.recalibrate();
        lib
    };
    let full = library_without(None);
    let mut without: HashMap<String, Library> = HashMap::new();

    let streams = read_json("queries.json");
    let mut q = read_f32("queries.f32").into_iter();
    let (mut by10, mut by20, mut wrong, mut unknown_false, mut n) = (0, 0, 0, 0, 0);
    for s in streams.as_array().unwrap() {
        n += 1;
        let truth = s["truth"].as_str().unwrap().to_string();
        #[expect(clippy::cast_possible_truncation, reason = "checkpoints are small whole seconds")]
        let checkpoints: Vec<f32> = s["checkpoints"].as_array().unwrap().iter().map(|t| t.as_f64().unwrap() as f32).collect();
        let queries: Vec<Vec<f32>> = q.by_ref().take(checkpoints.len()).collect();

        match first_commit(&full, &queries, &checkpoints, &strings(&s["known"])) {
            Some((t, song)) if song == truth => {
                by10 += i32::from(t <= 10.0);
                by20 += i32::from(t <= 20.0);
            }
            Some(_) => wrong += 1,
            None => {}
        }
        // "Song not in Manna": its references are removed from the library.
        let lib = without.entry(truth.clone()).or_insert_with(|| library_without(Some(&truth)));
        if first_commit(lib, &queries, &checkpoints, &strings(&s["unknown"])).is_some() {
            unknown_false += 1;
        }
    }
    let pct = |k: i32| f64::from(k) * 100.0 / f64::from(n);
    println!(
        "{n} streams: correct by 10 s {:.0}%, by 20 s {:.0}%, wrong {:.0}%, unknown-song false commit {:.0}%",
        pct(by10), pct(by20), pct(wrong), pct(unknown_false)
    );
    assert!(pct(wrong) <= 5.0, "too many wrong commits");
    assert!(pct(unknown_false) <= 10.0, "too many false commits on unknown songs");
    assert!(pct(by20) >= 55.0, "too few correct commits");
}
