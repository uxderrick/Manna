//! Splitting a song into its parts (vocals, bass, guitars and keys) with
//! Demucs, so a pack holds a reference for each: a leader singing alone,
//! a bass line, or a guitar playing the hook then matches the song as well
//! as the full band does. (On a solo-voice test, the vocals part matched
//! the right song in 8 of 8 checks, against 6 of 8 for the full mix, with
//! a far clearer lead.)
//!
//! Demucs (Meta, MIT) runs in Python, outside this tool:
//! `python3 -m venv ~/.manna-demucs && ~/.manna-demucs/bin/pip install demucs==4.0.1 torchaudio soundfile "numpy<2"`

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::audio;

/// The parts kept as references. Drums carry no melody or harmony.
pub const PARTS: [&str; 3] = ["vocals", "bass", "other"];

/// What a part is called in the pack and in messages.
pub fn part_label(part: &str) -> &str {
    match part {
        "other" => "guitars & keys",
        p => p,
    }
}

/// A part's name, its mono samples and their rate.
pub type Part = (&'static str, Vec<f32>, u32);

pub struct Separator {
    python: PathBuf,
    device: Option<String>,
}

fn has_demucs(python: &Path) -> bool {
    Command::new(python)
        .args(["-c", "import demucs"])
        .output()
        .is_ok_and(|o| o.status.success())
}

impl Separator {
    /// Find a Python with Demucs: `given`, `$MANNA_DEMUCS_PYTHON`, then the
    /// usual environments, then `python3`.
    pub fn find(given: Option<PathBuf>, device: Option<String>) -> Result<Self, String> {
        let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
        let candidates = given
            .into_iter()
            .chain(std::env::var_os("MANNA_DEMUCS_PYTHON").map(PathBuf::from))
            .chain([
                home.join(".manna-demucs/bin/python"),
                home.join("manna-song-data/.venv-demucs/bin/python"),
                PathBuf::from("python3"),
            ]);
        for python in candidates {
            if has_demucs(&python) {
                return Ok(Self { python, device });
            }
        }
        Err("--stems needs Demucs (Python). Install it with:\n  python3 -m venv ~/.manna-demucs && ~/.manna-demucs/bin/pip install demucs==4.0.1 torchaudio soundfile \"numpy<2\"\nor point --demucs-python at a Python that has it.".into())
    }

    /// Split mono audio at `rate` into [`PARTS`], each mono at its own rate.
    pub fn split(&self, samples: &[f32], rate: u32) -> Result<Vec<Part>, String> {
        let work = std::env::temp_dir().join(format!(
            "manna-songpack-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos())
        ));
        std::fs::create_dir_all(&work).map_err(|e| format!("temporary folder: {e}"))?;
        let result = self.split_in(&work, samples, rate);
        let _ = std::fs::remove_dir_all(&work);
        result
    }

    fn split_in(&self, work: &Path, samples: &[f32], rate: u32) -> Result<Vec<Part>, String> {
        let input = work.join("song.wav");
        // Stereo: Demucs widens mono input in a way that newer PyTorch
        // refuses to edit in place ("more than one element of the
        // written-to tensor refers to a single memory location").
        std::fs::write(&input, wav_f32(samples, rate, 2)).map_err(|e| format!("temporary audio: {e}"))?;
        let mut cmd = Command::new(&self.python);
        cmd.args(["-m", "demucs", "-n", "htdemucs", "-o"]).arg(work.join("out"));
        if let Some(device) = &self.device {
            cmd.args(["-d", device]);
        }
        let out = cmd.arg(&input).output().map_err(|e| format!("could not run Demucs: {e}"))?;
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr);
            let tail: Vec<&str> = err.lines().rev().take(3).collect();
            return Err(format!("Demucs failed: {}", tail.into_iter().rev().collect::<Vec<_>>().join(" / ")));
        }
        let dir = work.join("out/htdemucs/song");
        PARTS
            .iter()
            .map(|&part| {
                let (audio, rate) = audio::decode_mono(&dir.join(format!("{part}.wav")))?;
                Ok((part, audio, rate))
            })
            .collect()
    }
}

/// A 32-bit float WAV file of `samples` on each of `channels` channels.
pub fn wav_f32(samples: &[f32], rate: u32, channels: u16) -> Vec<u8> {
    let frame = 4 * u32::from(channels);
    let data_len = u32::try_from(samples.len()).unwrap_or(u32::MAX).saturating_mul(frame);
    let mut out = Vec::with_capacity(44 + samples.len() * 4 * usize::from(channels));
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&3u16.to_le_bytes()); // IEEE float
    out.extend_from_slice(&channels.to_le_bytes());
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * frame).to_le_bytes());
    out.extend_from_slice(&u16::try_from(frame).unwrap_or(u16::MAX).to_le_bytes());
    out.extend_from_slice(&32u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for s in samples {
        for _ in 0..channels {
            out.extend_from_slice(&s.to_le_bytes());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wav_files_read_back() {
        let samples: Vec<f32> = (0..8_000u16).map(|i| f32::from(i % 100) / 100.0 - 0.5).collect();
        let path = std::env::temp_dir().join(format!("manna-songpack-test-{}.wav", std::process::id()));
        std::fs::write(&path, wav_f32(&samples, 8_000, 2)).unwrap();
        let (back, rate) = audio::decode_mono(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        assert_eq!(rate, 8_000);
        assert_eq!(back.len(), samples.len());
        assert!(back.iter().zip(&samples).all(|(a, b)| (a - b).abs() < 1e-6));
    }

    #[test]
    fn parts_have_operator_names() {
        assert_eq!(part_label("other"), "guitars & keys");
        assert_eq!(part_label("vocals"), "vocals");
    }
}
