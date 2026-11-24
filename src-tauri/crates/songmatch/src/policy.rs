//! When to show a song.
//!
//! After at least 6 s of music, commit to the best candidate once it leads
//! the runner-up by `margin` cohort standard deviations. Before that, or
//! without a clear lead, offer the operator the top 3.
//!
//! The margin is in this crate's cohort units (calibrated on 20 s reference
//! shingles), which are wider than the research script's, so it was re-tuned
//! by replaying the research streams through this code
//! (`tests/replay.rs`). On 91 real song starts with a 6-song plan:
//!
//! | margin | correct by 10 s | by 20 s | wrong | unknown song committed |
//! |---|---|---|---|---|
//! | 2.0 | 57% | 84% | 3% | 9% |
//! | **2.5 (default)** | 47% | 78% | 2% | 3% |
//! | 3.0 | 38% | 74% | 1% | 2% |
//!
//! "Unknown song" there means the song's references are removed from the
//! library, a stricter test than the research script's.
//!
//! The service plan narrows the candidates (as in the benchmarks), but an
//! off-plan song that clearly beats every planned song is still surfaced, as
//! a suggestion only. Auto-presenting an unplanned song needs the operator.

use serde::Serialize;

use crate::library::SongScore;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PolicyConfig {
    /// Seconds of music heard before any commit.
    pub min_heard_s: f32,
    /// Lead over the runner-up (cohort-normalised) needed to commit.
    pub margin: f32,
    /// How many candidates to suggest.
    pub suggestions: usize,
    /// Seconds before suggestions start (very short clips are mostly noise).
    pub min_suggest_s: f32,
    /// How far an unplanned song must beat the best planned one to be shown.
    pub off_plan_margin: f32,
}

impl Default for PolicyConfig {
    fn default() -> Self {
        Self { min_heard_s: 6.0, margin: 2.5, suggestions: 3, min_suggest_s: 3.0, off_plan_margin: 1.0 }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub song_id: String,
    pub z: f32,
    pub similarity: f32,
    pub in_plan: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Decision {
    /// Not enough audio yet.
    Listening,
    /// Show these to the operator (best first); nothing is presented.
    Suggest { candidates: Vec<Candidate> },
    /// Confident: this song can be presented.
    Commit { candidate: Candidate },
}

/// Decide from a query's scores (best first, as [`crate::library::Library::score`]
/// returns them). `plan` lists the song ids in the service plan, if any.
pub fn decide(scores: &[SongScore], heard_s: f32, plan: &[String], cfg: &PolicyConfig) -> Decision {
    let planned = |id: &str| plan.iter().any(|p| p == id);
    let use_plan = scores.iter().any(|s| planned(&s.song_id));
    let candidate = |s: &SongScore| Candidate {
        song_id: s.song_id.clone(),
        z: s.z,
        similarity: s.similarity,
        in_plan: use_plan && planned(&s.song_id),
    };

    if heard_s < cfg.min_suggest_s || scores.is_empty() {
        return Decision::Listening;
    }
    let (pool, rest): (Vec<&SongScore>, Vec<&SongScore>) =
        scores.iter().partition(|s| !use_plan || planned(&s.song_id));

    let best = pool[0];
    // Runner-up within the pool; with a single candidate, the best song outside it.
    let runner = pool.get(1).or_else(|| rest.first()).copied();
    let off_plan = rest.first().filter(|o| o.z >= best.z + cfg.off_plan_margin);

    let mut suggested: Vec<Candidate> = Vec::new();
    if let Some(o) = off_plan {
        suggested.push(candidate(o));
    }
    suggested.extend(pool.iter().take(cfg.suggestions).map(|s| candidate(s)));
    suggested.truncate(cfg.suggestions);

    let clear_lead = runner.is_some_and(|r| best.z - r.z >= cfg.margin);
    if off_plan.is_none() && heard_s >= cfg.min_heard_s && clear_lead {
        return Decision::Commit { candidate: candidate(best) };
    }
    Decision::Suggest { candidates: suggested }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scores(list: &[(&str, f32)]) -> Vec<SongScore> {
        list.iter().map(|(id, z)| SongScore { song_id: (*id).into(), similarity: *z / 10.0, z: *z }).collect()
    }

    fn plan(ids: &[&str]) -> Vec<String> {
        ids.iter().map(|s| (*s).to_string()).collect()
    }

    fn ids(d: &Decision) -> Vec<String> {
        match d {
            Decision::Suggest { candidates } => candidates.iter().map(|c| c.song_id.clone()).collect(),
            Decision::Commit { candidate } => vec![candidate.song_id.clone()],
            Decision::Listening => vec![],
        }
    }

    #[test]
    fn waits_then_suggests_then_commits() {
        let cfg = PolicyConfig::default();
        let s = scores(&[("oceans", 5.0), ("jireh", 1.5), ("promises", 1.0), ("way-maker", 0.5)]);
        assert_eq!(decide(&s, 2.0, &[], &cfg), Decision::Listening);
        let early = decide(&s, 4.0, &[], &cfg);
        assert!(matches!(early, Decision::Suggest { .. }));
        assert_eq!(ids(&early), ["oceans", "jireh", "promises"]);
        assert!(matches!(decide(&s, 6.0, &[], &cfg), Decision::Commit { .. }));
    }

    #[test]
    fn no_commit_without_a_clear_lead() {
        let s = scores(&[("oceans", 2.0), ("jireh", 1.9)]);
        assert!(matches!(decide(&s, 12.0, &[], &PolicyConfig::default()), Decision::Suggest { .. }));
    }

    #[test]
    fn plan_narrows_the_candidates() {
        // Off-plan "jireh" is close to "oceans" but only planned songs compete.
        let s = scores(&[("jireh", 4.1), ("oceans", 4.0), ("promises", 1.0)]);
        let d = decide(&s, 8.0, &plan(&["oceans", "promises"]), &PolicyConfig::default());
        assert_eq!(d, Decision::Commit {
            candidate: Candidate { song_id: "oceans".into(), z: 4.0, similarity: 0.4, in_plan: true }
        });
    }

    #[test]
    fn a_clearly_better_unplanned_song_is_suggested_not_presented() {
        let s = scores(&[("raise-a-hallelujah", 6.0), ("oceans", 4.0), ("promises", 0.2)]);
        let d = decide(&s, 10.0, &plan(&["oceans", "promises"]), &PolicyConfig::default());
        assert!(matches!(d, Decision::Suggest { .. }));
        assert_eq!(ids(&d), ["raise-a-hallelujah", "oceans", "promises"]);
    }

    #[test]
    fn single_song_library_cannot_commit() {
        let s = scores(&[("oceans", 3.0)]);
        assert!(matches!(decide(&s, 10.0, &[], &PolicyConfig::default()), Decision::Suggest { .. }));
    }
}
