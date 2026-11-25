//! Live listening: feed microphone audio in, get decisions out.
//!
//! [`Matcher`] owns the rolling audio, the reference library and the service
//! plan. Every `check_every_s` seconds of music it embeds the latest
//! `max_query_s` seconds (the live-listening test used 2 s and 15 s), scores
//! the library and applies the [`policy`](crate::policy).
//!
//! Silence ends a listening episode: after `silence_reset_s` of quiet the
//! buffer is cleared, so the next song starts fresh (the policy needs to
//! know how long *this* song has been heard). Quiet before an episode
//! starts is ignored.
//!
//! When the operator confirms the song, [`Matcher::learn`] turns the
//! episode's audio into a new live reference (the "learn as they sing"
//! loop; see `docs/song-detection/results.md`).

use crate::buffer::AudioBuffer;
use crate::embedder::{embed_query, embed_reference, Embedder};
use crate::library::{Library, Reference, Source};
use crate::policy::{decide, Decision, PolicyConfig};
use crate::{Result, SAMPLE_RATE_HZ};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ListenerConfig {
    /// Seconds of audio between checks.
    pub check_every_s: f32,
    /// Longest query clip, in seconds.
    pub max_query_s: f32,
    /// Audio kept for learning from a confirmed song, in seconds.
    pub keep_s: f32,
    /// Below this RMS (full scale = 1.0) a frame counts as quiet.
    pub silence_rms: f32,
    /// Quiet this long ends the episode.
    pub silence_reset_s: f32,
    /// Least audio worth learning from, in seconds.
    pub min_learn_s: f32,
    /// Live references kept per song (oldest dropped).
    pub max_live_per_song: usize,
    pub policy: PolicyConfig,
}

impl Default for ListenerConfig {
    fn default() -> Self {
        Self {
            check_every_s: 2.0,
            max_query_s: 15.0,
            keep_s: 60.0,
            silence_rms: 0.003,
            silence_reset_s: 4.0,
            min_learn_s: 10.0,
            max_live_per_song: 3,
            policy: PolicyConfig::default(),
        }
    }
}

/// The result of one check.
#[derive(Debug, Clone, PartialEq)]
pub struct Update {
    pub heard_s: f32,
    pub decision: Decision,
    /// A commit to a different song than this episode's last commit (the
    /// moment to auto-present).
    pub new_commit: bool,
}

/// A reference learned from a confirmed performance, and the older live
/// references it replaced (to delete from storage).
#[derive(Debug, Clone, PartialEq)]
pub struct Learned {
    pub reference: Reference,
    pub dropped: Vec<String>,
}

#[derive(Debug)]
pub struct Matcher {
    cfg: ListenerConfig,
    buffer: AudioBuffer,
    since_check: usize,
    quiet: usize,
    library: Library,
    plan: Vec<String>,
    last_commit: Option<String>,
}

#[expect(clippy::cast_possible_truncation, clippy::cast_sign_loss, reason = "a few seconds of audio")]
fn samples(seconds: f32) -> usize {
    (seconds.max(0.0) * SAMPLE_RATE_HZ) as usize
}

fn rms(pcm: &[f32]) -> f32 {
    if pcm.is_empty() {
        return 0.0;
    }
    #[expect(clippy::cast_precision_loss, reason = "frames are small")]
    let n = pcm.len() as f32;
    (pcm.iter().map(|x| x * x).sum::<f32>() / n).sqrt()
}

impl Matcher {
    pub fn new(library: Library, cfg: ListenerConfig) -> Self {
        Self {
            buffer: AudioBuffer::new(cfg.keep_s.max(cfg.max_query_s)),
            cfg,
            since_check: 0,
            quiet: 0,
            library,
            plan: Vec::new(),
            last_commit: None,
        }
    }

    pub fn config(&self) -> &ListenerConfig {
        &self.cfg
    }

    pub fn library(&self) -> &Library {
        &self.library
    }

    /// Change references (then call [`Library::recalibrate`]).
    pub fn library_mut(&mut self) -> &mut Library {
        &mut self.library
    }

    pub fn set_library(&mut self, library: Library) {
        self.library = library;
    }

    /// Song ids in the service plan; empty means "any song".
    pub fn set_plan(&mut self, plan: Vec<String>) {
        self.plan = plan;
    }

    pub fn heard_seconds(&self) -> f32 {
        self.buffer.heard_seconds()
    }

    /// Start a new episode (silence, speech, or the operator moved on).
    pub fn reset(&mut self) {
        self.buffer.reset();
        self.since_check = 0;
        self.quiet = 0;
        self.last_commit = None;
    }

    /// Feed 16-bit PCM from the capture fan-out. Returns an update when a
    /// check ran, or when silence ended the episode.
    pub fn push_i16(&mut self, pcm: &[i16], embedder: &dyn Embedder) -> Result<Option<Update>> {
        let frame: Vec<f32> = pcm.iter().map(|&s| f32::from(s) / 32_768.0).collect();
        self.push_f32(&frame, embedder)
    }

    pub fn push_f32(&mut self, frame: &[f32], embedder: &dyn Embedder) -> Result<Option<Update>> {
        let in_episode = self.buffer.heard_seconds() > 0.0;
        if rms(frame) < self.cfg.silence_rms {
            if !in_episode {
                return Ok(None);
            }
            self.quiet += frame.len();
            if self.quiet >= samples(self.cfg.silence_reset_s) {
                self.reset();
                return Ok(Some(Update { heard_s: 0.0, decision: Decision::Listening, new_commit: false }));
            }
        } else {
            self.quiet = 0;
        }
        self.buffer.push_f32(frame);
        self.since_check += frame.len();
        if self.since_check < samples(self.cfg.check_every_s) {
            return Ok(None);
        }
        self.since_check = 0;
        self.check(embedder).map(Some)
    }

    /// Score the latest audio now.
    pub fn check(&mut self, embedder: &dyn Embedder) -> Result<Update> {
        let heard_s = self.buffer.heard_seconds();
        if heard_s < self.cfg.policy.min_suggest_s || self.library.is_empty() {
            return Ok(Update { heard_s, decision: Decision::Listening, new_commit: false });
        }
        let clip = self.buffer.latest(heard_s.min(self.cfg.max_query_s));
        let query = embed_query(embedder, &clip)?;
        let decision = decide(&self.library.score(&query), heard_s, &self.plan, &self.cfg.policy);
        let mut new_commit = false;
        if let Decision::Commit { candidate } = &decision {
            new_commit = self.last_commit.as_deref() != Some(candidate.song_id.as_str());
            self.last_commit = Some(candidate.song_id.clone());
        }
        Ok(Update { heard_s, decision, new_commit })
    }

    /// The operator confirmed `song_id` is playing: keep this episode's
    /// audio as a live reference called `reference_id`. Returns `None` when
    /// too little has been heard. Recalibrates the library.
    pub fn learn(&mut self, song_id: &str, reference_id: &str, embedder: &dyn Embedder) -> Result<Option<Learned>> {
        let heard_s = self.buffer.heard_seconds();
        if heard_s < self.cfg.min_learn_s {
            return Ok(None);
        }
        let audio = self.buffer.latest(self.cfg.keep_s);
        let reference = Reference {
            id: reference_id.to_string(),
            song_id: song_id.to_string(),
            source: Source::Live,
            embeddings: embed_reference(embedder, &audio)?,
        };
        let dropped = self.library.learn_live(reference.clone(), self.cfg.max_live_per_song);
        self.library.recalibrate();
        Ok(Some(Learned { reference, dropped }))
    }
}

#[cfg(test)]
#[expect(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "synthetic test levels are tiny"
)]
mod tests {
    use super::*;
    use crate::{normalize, EMBED_DIM, SAMPLE_RATE};

    /// Embeds a window by its mean sample value: songs are told apart by
    /// loudness, which is enough to drive the listener.
    struct LevelEmbedder;

    impl Embedder for LevelEmbedder {
        fn embed_windows(&self, windows: &[Vec<f32>]) -> Result<Vec<Vec<f32>>> {
            Ok(windows.iter().map(|w| level_vec(w.iter().sum::<f32>() / w.len() as f32)).collect())
        }
    }

    /// A unit vector pointing a different way for each level.
    fn level_vec(level: f32) -> Vec<f32> {
        let mut v = vec![0.0; EMBED_DIM];
        let bucket = ((level * 100.0).round() as usize).min(EMBED_DIM - 1);
        v[bucket] = 1.0;
        v[EMBED_DIM - 1] += 0.01;
        normalize(&mut v);
        v
    }

    fn song(id: &str, level: f32) -> Reference {
        Reference { id: format!("{id}-ref"), song_id: id.into(), source: Source::Library, embeddings: vec![level_vec(level)] }
    }

    fn matcher() -> Matcher {
        let mut lib = Library::new();
        for (i, id) in ["a", "b", "c", "d", "e"].iter().enumerate() {
            lib.add(song(id, 0.1 * (i + 1) as f32));
        }
        lib.recalibrate();
        let mut cfg = ListenerConfig::default();
        // Synthetic scores have no cohort spread; any lead commits.
        cfg.policy.margin = 0.01;
        Matcher::new(lib, cfg)
    }

    /// Feed `seconds` of a constant level in 0.1 s frames; collect updates.
    fn feed(m: &mut Matcher, level: f32, seconds: usize) -> Vec<Update> {
        let frame = vec![level; SAMPLE_RATE / 10];
        (0..seconds * 10).filter_map(|_| m.push_f32(&frame, &LevelEmbedder).unwrap()).collect()
    }

    #[test]
    fn quiet_before_a_song_is_ignored() {
        let mut m = matcher();
        assert!(feed(&mut m, 0.0, 10).is_empty());
        assert!(m.heard_seconds().abs() < f32::EPSILON);
    }

    #[test]
    fn checks_every_two_seconds_and_commits_once_per_song() {
        let mut m = matcher();
        let updates = feed(&mut m, 0.3, 12);
        assert_eq!(updates.len(), 6, "a check every 2 s");
        assert_eq!(updates[0].decision, Decision::Listening, "2 s is too short to suggest");
        assert!(matches!(updates[1].decision, Decision::Suggest { .. }), "4 s: suggestions only");
        let commits: Vec<&Update> = updates.iter().filter(|u| u.new_commit).collect();
        assert_eq!(commits.len(), 1);
        match &commits[0].decision {
            Decision::Commit { candidate } => assert_eq!(candidate.song_id, "c"),
            d => panic!("expected a commit, got {d:?}"),
        }
        assert!((commits[0].heard_s - 6.0).abs() < 0.01);
    }

    #[test]
    fn silence_ends_the_episode() {
        let mut m = matcher();
        feed(&mut m, 0.3, 8);
        let updates = feed(&mut m, 0.0, 5);
        assert!(updates.iter().any(|u| u.heard_s == 0.0 && u.decision == Decision::Listening));
        assert!(m.heard_seconds().abs() < f32::EPSILON);
        // The next song commits afresh.
        let next = feed(&mut m, 0.5, 8);
        assert!(next.iter().any(|u| u.new_commit && matches!(&u.decision, Decision::Commit { candidate } if candidate.song_id == "e")));
    }

    #[test]
    fn a_short_pause_keeps_the_episode() {
        let mut m = matcher();
        feed(&mut m, 0.3, 8);
        feed(&mut m, 0.0, 2);
        assert!(m.heard_seconds() > 8.0);
    }

    #[test]
    fn learning_needs_enough_audio_and_adds_a_live_reference() {
        let mut m = matcher();
        feed(&mut m, 0.3, 5);
        assert!(m.learn("c", "live-1", &LevelEmbedder).unwrap().is_none(), "5 s is too little");
        feed(&mut m, 0.3, 30);
        let learned = m.learn("c", "live-1", &LevelEmbedder).unwrap().unwrap();
        assert_eq!(learned.reference.source, Source::Live);
        assert_eq!(learned.reference.embeddings.len(), 2, "35 s -> 20 s windows at 0 and 10 s");
        assert!(learned.dropped.is_empty());
        assert_eq!(m.library().len(), 6);
    }
}
