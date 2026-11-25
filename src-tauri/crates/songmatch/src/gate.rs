//! Singing gate: while songs are being detected, only audio that sounds like
//! singing or music reaches speech recognition.
//!
//! A small sound classifier (Google's `YAMNet`, `AudioSet` classes) scores each
//! 0.48 s of audio. The gate opens on singing or music and stays open
//! through soft or quiet moments; it closes on sustained talk, or a few
//! seconds after the music stops. Audio it keeps out is replaced with
//! silence, so speech recognition sees a quiet room: Whisper skips it, and
//! cloud streams stay connected.
//!
//! Opening late would cut the first words of a line, so the output runs
//! [`GateConfig::preroll_s`] behind the input: when the gate opens, the
//! second before it opens too.
//!
//! On a 16-minute test recording (five sung passages amid talk and room
//! noise) the gate let through all five and was open 11% of the time.

use std::collections::VecDeque;

use crate::Result;

/// Audio between classifications: 0.48 s, `YAMNet`'s hop.
pub const HOP_SAMPLES: usize = 7_680;
/// Audio per classification: 0.975 s, one `YAMNet` patch.
pub const WINDOW_SAMPLES: usize = 15_600;
const HOP_SECONDS: f32 = 0.48;

/// What a window of audio sounds like, each 0 to 1.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct SoundScores {
    /// Strongest of the singing and music classes.
    pub music: f32,
    pub speech: f32,
}

/// Scores windows of 16 kHz audio (the ONNX model, or a fake in tests).
pub trait SoundClassifier: Send {
    fn classify(&mut self, window: &[f32]) -> Result<SoundScores>;
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GateConfig {
    /// Music or singing score that opens the gate.
    pub open_music: f32,
    /// How long the gate stays open after the last music.
    pub hold_s: f32,
    /// Speech score that counts as talk (when music is below `talk_music_max`).
    pub talk_speech: f32,
    pub talk_music_max: f32,
    /// Talk this long closes the gate early.
    pub close_talk_s: f32,
    /// Audio kept from before the gate opened.
    pub preroll_s: f32,
}

impl Default for GateConfig {
    fn default() -> Self {
        Self { open_music: 0.15, hold_s: 3.0, talk_speech: 0.5, talk_music_max: 0.1, close_talk_s: 2.0, preroll_s: 1.0 }
    }
}

#[expect(clippy::cast_possible_truncation, clippy::cast_sign_loss, reason = "a few seconds in hops")]
fn hops(seconds: f32) -> usize {
    (seconds / HOP_SECONDS).round().max(0.0) as usize
}

pub struct SingingGate {
    classifier: Box<dyn SoundClassifier>,
    cfg: GateConfig,
    /// The last [`WINDOW_SAMPLES`] of audio, for classification.
    window: VecDeque<f32>,
    /// Audio not yet a whole hop.
    incoming: Vec<i16>,
    /// Hops waiting out the pre-roll, with whether each passes.
    queue: VecDeque<(Vec<i16>, bool)>,
    hold_left: usize,
    talk_run: usize,
    open: bool,
}

impl SingingGate {
    pub fn new(classifier: Box<dyn SoundClassifier>, cfg: GateConfig) -> Self {
        Self {
            classifier,
            cfg,
            window: VecDeque::with_capacity(WINDOW_SAMPLES),
            incoming: Vec::with_capacity(HOP_SAMPLES * 2),
            queue: VecDeque::new(),
            hold_left: 0,
            talk_run: 0,
            open: false,
        }
    }

    /// Whether the last hop classified passed.
    pub fn is_open(&self) -> bool {
        self.open
    }

    /// Start over (songs mode switched on, or a new service).
    pub fn reset(&mut self) {
        self.window.clear();
        self.incoming.clear();
        self.queue.clear();
        self.hold_left = 0;
        self.talk_run = 0;
        self.open = false;
    }

    /// Feed captured audio; returns the audio for speech recognition, with
    /// gated-out stretches silenced. Output comes in whole hops and runs
    /// [`GateConfig::preroll_s`] behind the input.
    pub fn push(&mut self, pcm: &[i16]) -> Vec<i16> {
        self.incoming.extend_from_slice(pcm);
        let mut out = Vec::new();
        while self.incoming.len() >= HOP_SAMPLES {
            let hop: Vec<i16> = self.incoming.drain(..HOP_SAMPLES).collect();
            for &s in &hop {
                if self.window.len() == WINDOW_SAMPLES {
                    self.window.pop_front();
                }
                self.window.push_back(f32::from(s) / 32_768.0);
            }
            let open = self.decide();
            if open {
                // Let the pre-roll through too.
                for queued in &mut self.queue {
                    queued.1 = true;
                }
            }
            self.queue.push_back((hop, open));
            while self.queue.len() > hops(self.cfg.preroll_s) {
                if let Some((hop, pass)) = self.queue.pop_front() {
                    if pass {
                        out.extend_from_slice(&hop);
                    } else {
                        out.resize(out.len() + hop.len(), 0);
                    }
                }
            }
        }
        out
    }

    fn decide(&mut self) -> bool {
        let window: Vec<f32> = self.window.iter().copied().collect();
        // A classifier failure lets audio through: never lose singing.
        let Ok(s) = self.classifier.classify(&window) else {
            self.open = true;
            return true;
        };
        let talk = s.speech >= self.cfg.talk_speech && s.music < self.cfg.talk_music_max;
        self.talk_run = if talk { self.talk_run + 1 } else { 0 };
        if s.music >= self.cfg.open_music {
            self.hold_left = hops(self.cfg.hold_s);
        } else if self.talk_run >= hops(self.cfg.close_talk_s) {
            self.hold_left = 0;
        }
        self.open = self.hold_left > 0;
        self.hold_left = self.hold_left.saturating_sub(1);
        self.open
    }
}

#[cfg(feature = "onnx-core")]
pub use onnx::YamnetClassifier;

#[cfg(feature = "onnx-core")]
mod onnx {
    use std::path::Path;

    use ort::session::Session;
    use ort::value::Tensor;

    use super::{SoundClassifier, SoundScores};
    use crate::{Result, SongMatchError};

    /// `AudioSet` classes that mean singing or music: Music, Singing, Choir,
    /// Chant, Mantra, Humming, A capella, Lullaby, Christian music, Gospel
    /// music, Child singing. Soft singing often scores as Humming or Lullaby
    /// rather than Singing.
    const MUSIC_CLASSES: [usize; 11] = [132, 24, 25, 27, 28, 32, 250, 266, 253, 254, 29];
    const SPEECH_CLASS: usize = 0;
    const CLASSES: usize = 521;

    /// `YAMNet` through ONNX Runtime (`yamnet.onnx`, 16 MB; raw waveform in).
    pub struct YamnetClassifier {
        session: Session,
    }

    impl YamnetClassifier {
        pub fn load(model_path: &Path) -> Result<Self> {
            fn err(e: impl std::fmt::Display) -> SongMatchError {
                SongMatchError::Model(e.to_string())
            }
            let session = Session::builder()
                .map_err(err)?
                .with_intra_threads(1)
                .map_err(err)?
                .commit_from_file(model_path)
                .map_err(err)?;
            Ok(Self { session })
        }
    }

    impl SoundClassifier for YamnetClassifier {
        fn classify(&mut self, window: &[f32]) -> Result<SoundScores> {
            let err = |e: ort::Error| SongMatchError::Model(e.to_string());
            // YAMNet needs at least one patch; pad the start of the stream.
            let mut data = vec![0.0; super::WINDOW_SAMPLES.saturating_sub(window.len())];
            data.extend_from_slice(window);
            #[expect(clippy::cast_possible_wrap, reason = "one second of audio")]
            let input = Tensor::from_array((vec![data.len() as i64], data)).map_err(err)?;
            let outputs = self.session.run(ort::inputs!["waveform" => input]).map_err(err)?;
            let (_, scores) = outputs[0usize].try_extract_tensor::<f32>().map_err(err)?;
            if scores.len() < CLASSES {
                return Err(SongMatchError::Dimension { got: scores.len(), expected: CLASSES });
            }
            let mut out = SoundScores::default();
            for frame in scores.as_chunks::<CLASSES>().0 {
                out.speech = out.speech.max(frame[SPEECH_CLASS]);
                for &c in &MUSIC_CLASSES {
                    out.music = out.music.max(frame[c]);
                }
            }
            Ok(out)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Plays back a script of scores, one per hop.
    struct Script(VecDeque<SoundScores>);

    impl SoundClassifier for Script {
        fn classify(&mut self, _window: &[f32]) -> Result<SoundScores> {
            Ok(self.0.pop_front().unwrap_or_default())
        }
    }

    const MUSIC: SoundScores = SoundScores { music: 0.6, speech: 0.0 };
    const TALK: SoundScores = SoundScores { music: 0.0, speech: 0.9 };
    const QUIET: SoundScores = SoundScores { music: 0.02, speech: 0.05 };

    /// Run hops numbered 1, 2, 3... through the gate; returns which come
    /// out unsilenced, in order, plus the number of hops out.
    fn run(script: &[SoundScores]) -> (Vec<i16>, usize) {
        let mut gate = SingingGate::new(Box::new(Script(script.iter().copied().collect())), GateConfig::default());
        let mut out = Vec::new();
        for i in 1..=i16::try_from(script.len()).unwrap() {
            out.extend(gate.push(&vec![i; HOP_SAMPLES]));
        }
        let hops_out = out.len() / HOP_SAMPLES;
        let passed = out.chunks(HOP_SAMPLES).map(|h| h[0]).filter(|&v| v != 0).collect();
        (passed, hops_out)
    }

    #[test]
    fn talk_is_silenced_and_singing_passes_with_its_lead_in() {
        // hops: 1-4 talk, 5-8 singing, 9-16 talk
        let mut s = vec![TALK; 4];
        s.extend([MUSIC; 4]);
        s.extend([TALK; 8]);
        let (passed, hops_out) = run(&s);
        assert_eq!(hops_out, 16 - 2, "output runs two hops (about 1 s) behind");
        // Hops 3-4 are the pre-roll; after the singing, 4 hops (2 s) of talk close it.
        assert_eq!(passed, vec![3, 4, 5, 6, 7, 8, 9, 10, 11]);
    }

    #[test]
    fn soft_moments_inside_a_song_keep_the_gate_open() {
        let s = [MUSIC, QUIET, QUIET, MUSIC, QUIET, MUSIC, QUIET, QUIET, QUIET, QUIET, QUIET, QUIET, QUIET, QUIET];
        let (passed, _) = run(&s);
        assert!((1..=11).all(|h| passed.contains(&h)), "{passed:?}");
        assert!(!passed.contains(&12), "closes about 3 s after the last music: {passed:?}");
    }

    #[test]
    fn room_noise_alone_never_opens() {
        let (passed, _) = run(&[QUIET; 12]);
        assert!(passed.is_empty());
    }

    #[test]
    fn a_failing_classifier_lets_audio_through() {
        struct Broken;
        impl SoundClassifier for Broken {
            fn classify(&mut self, _window: &[f32]) -> Result<SoundScores> {
                Err(crate::SongMatchError::Model("broken".into()))
            }
        }
        let mut gate = SingingGate::new(Box::new(Broken), GateConfig::default());
        let out: Vec<i16> = (0..4).flat_map(|_| gate.push(&[7; HOP_SAMPLES])).collect();
        assert!(out.iter().all(|&v| v == 7) && !out.is_empty());
    }

    #[test]
    fn odd_sized_input_is_buffered_into_hops() {
        let mut gate = SingingGate::new(Box::new(Script([MUSIC; 8].into_iter().collect())), GateConfig::default());
        let mut total = 0;
        // A Mac's built-in mic delivers 171 samples at a time.
        for _ in 0..(HOP_SAMPLES * 5).div_ceil(171) {
            total += gate.push(&[1; 171]).len();
        }
        assert_eq!(total, HOP_SAMPLES * 3, "5 hops in, 2 held back");
    }
}
