//! Reference fingerprints per song, and scoring a live query against them.
//!
//! A song can have several references: shipped with Manna (`Library`),
//! added by the operator from a recording (`Operator`), or learned from a
//! confirmed live performance (`Live`). A song's similarity to a query is
//! the best cosine between the query and any shingle of any of its
//! references.
//!
//! Raw cosine favours songs that "sound like everything" (long, dense
//! arrangements). Cohort normalisation fixes that: each song learns how
//! similar it usually is to *other* songs' audio, and scores are reported in
//! standard deviations above that (`z`). The research found this worth
//! about 6 points of top-1 accuracy.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::dot;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    /// Shipped with Manna.
    Library,
    /// Added by the operator from a recording.
    Operator,
    /// Learned from a confirmed live performance.
    Live,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Reference {
    pub id: String,
    pub song_id: String,
    pub source: Source,
    /// Unit-length embeddings, one per shingle.
    pub embeddings: Vec<Vec<f32>>,
}

/// How similar a song typically is to other songs' audio.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Cohort {
    pub mean: f32,
    pub std: f32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SongScore {
    pub song_id: String,
    /// Best cosine similarity to any of the song's references.
    pub similarity: f32,
    /// Cohort-normalised score (falls back to `similarity` without a cohort).
    pub z: f32,
}

/// Impostor shingles sampled per reference when calibrating (the research
/// used up to 8 windows per reference recording).
const COHORT_SAMPLES_PER_REF: usize = 8;
/// Every 3rd shingle: shingles are 10 s apart, the research sampled every 30 s.
const COHORT_STRIDE: usize = 3;
const MIN_COHORT: usize = 4;

#[derive(Debug, Default)]
pub struct Library {
    refs: Vec<Reference>,
    cohort: HashMap<String, Cohort>,
}

impl Library {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn len(&self) -> usize {
        self.refs.len()
    }

    pub fn is_empty(&self) -> bool {
        self.refs.is_empty()
    }

    pub fn references(&self) -> &[Reference] {
        &self.refs
    }

    /// Song ids with at least one reference.
    pub fn songs(&self) -> Vec<&str> {
        let mut ids: Vec<&str> = self.refs.iter().map(|r| r.song_id.as_str()).collect();
        ids.sort_unstable();
        ids.dedup();
        ids
    }

    pub fn cohort(&self, song_id: &str) -> Option<Cohort> {
        self.cohort.get(song_id).copied()
    }

    /// Add (or replace, by id) a reference. Call [`Library::recalibrate`]
    /// after a batch of changes.
    pub fn add(&mut self, reference: Reference) {
        self.refs.retain(|r| r.id != reference.id);
        self.refs.push(reference);
    }

    pub fn remove(&mut self, reference_id: &str) -> bool {
        let before = self.refs.len();
        self.refs.retain(|r| r.id != reference_id);
        before != self.refs.len()
    }

    pub fn remove_song(&mut self, song_id: &str) {
        self.refs.retain(|r| r.song_id != song_id);
        self.cohort.remove(song_id);
    }

    /// Keep a confirmed live performance as a new reference, keeping at most
    /// `max_live` live references per song (oldest dropped first). Returns
    /// the ids of dropped references so storage can delete them too.
    pub fn learn_live(&mut self, reference: Reference, max_live: usize) -> Vec<String> {
        let song = reference.song_id.clone();
        self.add(Reference { source: Source::Live, ..reference });
        let live: Vec<String> = self
            .refs
            .iter()
            .filter(|r| r.song_id == song && r.source == Source::Live)
            .map(|r| r.id.clone())
            .collect();
        let drop_count = live.len().saturating_sub(max_live);
        let dropped: Vec<String> = live.into_iter().take(drop_count).collect();
        self.refs.retain(|r| !dropped.contains(&r.id));
        dropped
    }

    /// Best cosine per song for one query embedding.
    pub fn similarities(&self, query: &[f32]) -> HashMap<String, f32> {
        let mut best: HashMap<String, f32> = HashMap::new();
        for r in &self.refs {
            let s = r.embeddings.iter().map(|e| dot(e, query)).fold(f32::MIN, f32::max);
            let entry = best.entry(r.song_id.clone()).or_insert(f32::MIN);
            if s > *entry {
                *entry = s;
            }
        }
        best
    }

    /// Re-learn every song's cohort: score sampled shingles of each reference
    /// against all songs, and record each *other* song's similarity.
    pub fn recalibrate(&mut self) {
        let mut impostor: HashMap<String, Vec<f32>> = HashMap::new();
        for r in &self.refs {
            for q in r.embeddings.iter().step_by(COHORT_STRIDE).take(COHORT_SAMPLES_PER_REF) {
                for (song, s) in self.similarities(q) {
                    if song != r.song_id {
                        impostor.entry(song).or_default().push(s);
                    }
                }
            }
        }
        self.cohort = impostor
            .into_iter()
            .filter(|(_, v)| v.len() >= MIN_COHORT)
            .map(|(song, v)| (song, cohort_of(&v)))
            .collect();
    }

    /// Every song's score for a query, best first (by `z`).
    pub fn score(&self, query: &[f32]) -> Vec<SongScore> {
        let mut out: Vec<SongScore> = self
            .similarities(query)
            .into_iter()
            .map(|(song_id, similarity)| {
                let z = self.cohort.get(&song_id).map_or(similarity, |c| (similarity - c.mean) / c.std);
                SongScore { song_id, similarity, z }
            })
            .collect();
        out.sort_by(|a, b| b.z.total_cmp(&a.z).then_with(|| a.song_id.cmp(&b.song_id)));
        out
    }
}

#[expect(clippy::cast_precision_loss, reason = "cohort sizes are small")]
fn cohort_of(values: &[f32]) -> Cohort {
    let n = values.len() as f32;
    let mean = values.iter().sum::<f32>() / n;
    let var = values.iter().map(|v| (v - mean).powi(2)).sum::<f32>() / n;
    Cohort { mean, std: var.sqrt() + 1e-6 }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::normalize;

    fn unit(v: &[f32]) -> Vec<f32> {
        let mut v = v.to_vec();
        normalize(&mut v);
        v
    }

    fn reference(id: &str, song: &str, source: Source, embs: &[&[f32]]) -> Reference {
        Reference { id: id.into(), song_id: song.into(), source, embeddings: embs.iter().map(|e| unit(e)).collect() }
    }

    #[test]
    fn best_shingle_of_any_reference_wins() {
        let mut lib = Library::new();
        lib.add(reference("a1", "a", Source::Library, &[&[1.0, 0.0, 0.0], &[0.0, 1.0, 0.0]]));
        lib.add(reference("b1", "b", Source::Library, &[&[0.0, 0.0, 1.0]]));
        let sims = lib.similarities(&unit(&[0.1, 1.0, 0.0]));
        assert!(sims["a"] > 0.99 && sims["b"] < 0.01);
        assert_eq!(lib.score(&unit(&[0.1, 1.0, 0.0]))[0].song_id, "a");
    }

    #[test]
    fn live_learning_keeps_the_newest_few() {
        let mut lib = Library::new();
        lib.add(reference("base", "a", Source::Library, &[&[1.0, 0.0]]));
        for i in 0..4 {
            let dropped = lib.learn_live(reference(&format!("live{i}"), "a", Source::Operator, &[&[1.0, 1.0]]), 2);
            assert_eq!(dropped, if i >= 2 { vec![format!("live{}", i - 2)] } else { vec![] });
        }
        let ids: Vec<_> = lib.references().iter().map(|r| (r.id.as_str(), r.source)).collect();
        assert_eq!(ids, [("base", Source::Library), ("live2", Source::Live), ("live3", Source::Live)]);
    }

    #[test]
    fn cohort_tracks_how_much_a_song_resembles_others() {
        // "busy" resembles every query a bit; "quiet" only resembles its own.
        let mut lib = Library::new();
        let busy: Vec<Vec<f32>> = (0..8).map(|i| unit(&[1.0, 1.0, 1.0, f32::from(u8::try_from(i).unwrap()) * 0.01])).collect();
        lib.add(Reference { id: "busy".into(), song_id: "busy".into(), source: Source::Library, embeddings: busy });
        let quiet: Vec<Vec<f32>> = (0..8).map(|_| unit(&[0.0, 0.0, 1.0, 1.0])).collect();
        lib.add(Reference { id: "quiet".into(), song_id: "quiet".into(), source: Source::Library, embeddings: quiet });
        let other: Vec<Vec<f32>> = (0..8).map(|_| unit(&[1.0, 0.0, 0.0, 0.0])).collect();
        lib.add(Reference { id: "other".into(), song_id: "other".into(), source: Source::Library, embeddings: other });
        lib.recalibrate();
        let (busy, quiet) = (lib.cohort("busy").unwrap(), lib.cohort("quiet").unwrap());
        assert!(busy.mean > quiet.mean, "busy resembles other songs more: {busy:?} vs {quiet:?}");
        // Scores are reported in cohort standard deviations.
        let q = unit(&[0.5, 0.5, 1.0, 0.5]);
        let sims = lib.similarities(&q);
        for s in lib.score(&q) {
            let c = lib.cohort(&s.song_id).unwrap();
            assert!((s.z - (sims[&s.song_id] - c.mean) / c.std).abs() < 1e-4);
        }
    }
}
