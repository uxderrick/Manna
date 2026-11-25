//! Rolling buffer of the most recent live audio.

use std::collections::VecDeque;

use crate::SAMPLE_RATE_HZ;

/// Keeps the last `capacity` samples of 16 kHz mono audio and counts how
/// long the current listening episode has run (since the last [`reset`]).
///
/// [`reset`]: AudioBuffer::reset
#[derive(Debug)]
pub struct AudioBuffer {
    samples: VecDeque<f32>,
    capacity: usize,
    heard: usize,
}

impl AudioBuffer {
    pub fn new(max_seconds: f32) -> Self {
        #[expect(clippy::cast_possible_truncation, clippy::cast_sign_loss, reason = "a few seconds of audio")]
        let capacity = (max_seconds.max(0.0) * SAMPLE_RATE_HZ) as usize;
        Self { samples: VecDeque::with_capacity(capacity), capacity, heard: 0 }
    }

    /// Append 16-bit PCM from the capture fan-out.
    pub fn push_i16(&mut self, pcm: &[i16]) {
        self.extend(pcm.iter().map(|&s| f32::from(s) / 32_768.0));
    }

    pub fn push_f32(&mut self, pcm: &[f32]) {
        self.extend(pcm.iter().copied());
    }

    fn extend(&mut self, samples: impl Iterator<Item = f32>) {
        for s in samples {
            if self.samples.len() == self.capacity {
                self.samples.pop_front();
            }
            self.samples.push_back(s);
            self.heard += 1;
        }
    }

    /// Seconds of audio since the episode started.
    #[expect(clippy::cast_precision_loss, reason = "sample counts stay far below 2^23 per episode")]
    pub fn heard_seconds(&self) -> f32 {
        self.heard as f32 / SAMPLE_RATE_HZ
    }

    /// The most recent `seconds` of audio (or all of it, if less is buffered).
    pub fn latest(&self, seconds: f32) -> Vec<f32> {
        #[expect(clippy::cast_possible_truncation, clippy::cast_sign_loss, reason = "a few seconds of audio")]
        let n = ((seconds.max(0.0) * SAMPLE_RATE_HZ) as usize).min(self.samples.len());
        self.samples.iter().skip(self.samples.len() - n).copied().collect()
    }

    /// Start a new episode (e.g. after silence or speech).
    pub fn reset(&mut self) {
        self.samples.clear();
        self.heard = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SAMPLE_RATE;

    #[test]
    fn keeps_only_the_latest_audio_and_counts_the_episode() {
        let mut b = AudioBuffer::new(1.0);
        b.push_f32(&vec![0.1; SAMPLE_RATE]);
        b.push_f32(&vec![0.2; SAMPLE_RATE / 2]);
        assert!((b.heard_seconds() - 1.5).abs() < 1e-6);
        let last = b.latest(10.0);
        assert_eq!(last.len(), SAMPLE_RATE, "capped at capacity");
        assert!((last[last.len() - 1] - 0.2).abs() < 1e-6);
        assert!((last[0] - 0.1).abs() < 1e-6);
        assert_eq!(b.latest(0.25).len(), SAMPLE_RATE / 4);
        b.reset();
        assert!(b.heard_seconds().abs() < f32::EPSILON);
        assert!(b.latest(1.0).is_empty());
    }

    #[test]
    fn converts_pcm16() {
        let mut b = AudioBuffer::new(1.0);
        b.push_i16(&[i16::MAX, i16::MIN, 0]);
        let v = b.latest(1.0);
        assert!((v[0] - 0.999_97).abs() < 1e-4 && (v[1] + 1.0).abs() < 1e-6 && v[2] == 0.0);
    }
}
