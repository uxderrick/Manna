//! Song packs: sound fingerprints of whole songs in one portable file, made
//! outside Manna (the `manna-songpack` tool) and imported into any install.
//!
//! A pack holds no audio, only each recording's embeddings (20 s windows
//! every 10 s), keyed by song title so it can be matched to that install's
//! songs, whatever their ids. Embeddings are stored as 8-bit values with a
//! scale per window (about 1 KB per window, 25 KB for a 4-minute song); the
//! rounding moves similarities by well under 1%.
//!
//! The file is JSON:
//! `{"format":"manna-song-pack","version":1,"model":"…","dim":1024,"songs":[…]}`,
//! each song `{"title","artist","recordings":[{"name","seconds","windows","embeddings"}]}`
//! with `embeddings` base64 of, per window, an f32 scale (little-endian)
//! then `dim` signed bytes.

use base64::Engine as _;
use serde::{Deserialize, Serialize};

use crate::{normalize, Result, SongMatchError, EMBED_DIM};

pub const PACK_FORMAT: &str = "manna-song-pack";
pub const PACK_VERSION: u32 = 1;
/// File extension for song packs.
pub const PACK_EXTENSION: &str = "mannasongs";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SongPack {
    pub format: String,
    pub version: u32,
    /// Model the embeddings were made with; other models' packs are refused.
    pub model: String,
    pub dim: usize,
    pub songs: Vec<PackSong>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PackSong {
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,
    pub recordings: Vec<PackRecording>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PackRecording {
    /// Where it came from (the audio file's name), for the operator.
    pub name: String,
    pub seconds: f32,
    pub windows: usize,
    pub embeddings: String,
    /// Which part of the song this is, when it was split ("vocals",
    /// "bass", "other"); absent for the full mix.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub part: Option<String>,
}

fn bad(what: impl Into<String>) -> SongMatchError {
    SongMatchError::Model(format!("song pack: {}", what.into()))
}

/// A title for matching across installs: letters and digits, lowercased.
pub fn title_key(title: &str) -> String {
    title.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

/// The title without bracketed parts ("Holy Spirit (Live)" → "Holy Spirit"),
/// for a second, looser match.
pub fn loose_title_key(title: &str) -> String {
    let mut depth = 0usize;
    let plain: String = title
        .chars()
        .filter(|&c| {
            match c {
                '(' | '[' => depth += 1,
                ')' | ']' => depth = depth.saturating_sub(1),
                _ => return depth == 0,
            }
            false
        })
        .collect();
    title_key(&plain)
}

impl SongPack {
    pub fn new(model: &str) -> Self {
        Self { format: PACK_FORMAT.into(), version: PACK_VERSION, model: model.into(), dim: EMBED_DIM, songs: Vec::new() }
    }

    /// Read a pack, checking it is one this version understands.
    pub fn from_json(json: &str) -> Result<Self> {
        let pack: Self = serde_json::from_str(json).map_err(|e| bad(format!("not a song pack ({e})")))?;
        if pack.format != PACK_FORMAT {
            return Err(bad("not a song pack"));
        }
        if pack.version > PACK_VERSION {
            return Err(bad(format!("made by a newer Manna (version {})", pack.version)));
        }
        if pack.dim != EMBED_DIM {
            return Err(bad(format!("embeddings have {} values, expected {EMBED_DIM}", pack.dim)));
        }
        Ok(pack)
    }

    pub fn to_json(&self) -> Result<String> {
        serde_json::to_string(self).map_err(|e| bad(e.to_string()))
    }

    /// Add a recording of `title`, joining a song already in the pack with
    /// that title. A recording with the same name replaces the old one.
    pub fn add(&mut self, title: &str, artist: Option<&str>, recording: PackRecording) {
        let key = title_key(title);
        let i = self.songs.iter().position(|s| title_key(&s.title) == key).unwrap_or_else(|| {
            self.songs.push(PackSong { title: title.trim().into(), artist: artist.map(Into::into), recordings: Vec::new() });
            self.songs.len() - 1
        });
        let song = &mut self.songs[i];
        song.recordings.retain(|r| r.name != recording.name);
        song.recordings.push(recording);
    }

    /// Recordings across all songs.
    pub fn recordings(&self) -> usize {
        self.songs.iter().map(|s| s.recordings.len()).sum()
    }
}

impl PackRecording {
    /// Store a recording's embeddings (unit vectors of [`EMBED_DIM`]).
    pub fn encode(name: &str, seconds: f32, embeddings: &[Vec<f32>]) -> Result<Self> {
        let mut bytes = Vec::with_capacity(embeddings.len() * (4 + EMBED_DIM));
        for e in embeddings {
            if e.len() != EMBED_DIM {
                return Err(SongMatchError::Dimension { got: e.len(), expected: EMBED_DIM });
            }
            let peak = e.iter().fold(0.0_f32, |m, x| m.max(x.abs())).max(f32::MIN_POSITIVE);
            let scale = peak / 127.0;
            bytes.extend_from_slice(&scale.to_le_bytes());
            for x in e {
                #[expect(clippy::cast_possible_truncation, reason = "rounded and clamped to the i8 range")]
                let q = (x / scale).round().clamp(-127.0, 127.0) as i8;
                bytes.push(q.to_le_bytes()[0]);
            }
        }
        Ok(Self {
            name: name.into(),
            seconds,
            windows: embeddings.len(),
            embeddings: base64::engine::general_purpose::STANDARD.encode(bytes),
            part: None,
        })
    }

    /// The embeddings back, as unit vectors.
    pub fn embeddings(&self) -> Result<Vec<Vec<f32>>> {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&self.embeddings)
            .map_err(|e| bad(format!("{}: {e}", self.name)))?;
        let per = 4 + EMBED_DIM;
        if bytes.len() != self.windows * per {
            return Err(bad(format!("{}: {} bytes for {} windows", self.name, bytes.len(), self.windows)));
        }
        Ok(bytes
            .chunks_exact(per)
            .map(|w| {
                let scale = f32::from_le_bytes([w[0], w[1], w[2], w[3]]);
                let mut v: Vec<f32> = w[4..].iter().map(|&b| f32::from(i8::from_le_bytes([b])) * scale).collect();
                normalize(&mut v);
                v
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dot;

    /// A unit vector that looks like a real embedding (many small values).
    fn embedding(seed: u32) -> Vec<f32> {
        let mut v: Vec<f32> = (0..EMBED_DIM)
            .map(|i| {
                let x = (u32::try_from(i).unwrap().wrapping_mul(2_654_435_761) ^ seed.wrapping_mul(40_503)) % 1000;
                f32::from(u16::try_from(x).unwrap()) / 500.0 - 1.0
            })
            .collect();
        normalize(&mut v);
        v
    }

    #[test]
    fn embeddings_survive_the_round_trip() {
        let original = vec![embedding(1), embedding(2), embedding(3)];
        let rec = PackRecording::encode("No One Like the Lord.m4a", 243.0, &original).unwrap();
        let back = rec.embeddings().unwrap();
        assert_eq!(back.len(), 3);
        for (a, b) in original.iter().zip(&back) {
            assert!(dot(a, b) > 0.999, "similarity {}", dot(a, b));
        }
        // Different windows stay as different as they were.
        assert!((dot(&back[0], &back[1]) - dot(&original[0], &original[1])).abs() < 0.005);
        assert!(rec.embeddings.len() < 3 * 1400, "about 1 KB per window, base64");
    }

    #[test]
    fn packs_round_trip_and_merge_by_title() {
        let rec = |name: &str| PackRecording::encode(name, 10.0, &[embedding(7)]).unwrap();
        let mut pack = SongPack::new("clews-dvi-int8-v1");
        pack.add("No One Like the Lord", None, rec("a.mp3"));
        pack.add("no one like the LORD!", None, rec("b.m4a"));
        pack.add("No One Like the Lord", None, rec("a.mp3"));
        pack.add("Silent Night", Some("Gruber"), rec("c.mp3"));
        assert_eq!(pack.songs.len(), 2);
        assert_eq!(pack.songs[0].recordings.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(), ["b.m4a", "a.mp3"]);
        let mut vocals = rec("a.mp3 (vocals)");
        vocals.part = Some("vocals".into());
        pack.add("Silent Night", None, vocals);
        let json = pack.to_json().unwrap();
        assert_eq!(json.matches("\"part\"").count(), 1, "only split parts say which part they are");
        let again = SongPack::from_json(&json).unwrap();
        assert_eq!(again, pack);
        assert_eq!(again.recordings(), 4);
    }

    #[test]
    fn other_files_are_refused() {
        assert!(SongPack::from_json("{}").is_err());
        assert!(SongPack::from_json(r#"{"format":"x","version":1,"model":"m","dim":1024,"songs":[]}"#).is_err());
        assert!(SongPack::from_json(r#"{"format":"manna-song-pack","version":9,"model":"m","dim":1024,"songs":[]}"#).is_err());
        assert!(SongPack::from_json(r#"{"format":"manna-song-pack","version":1,"model":"m","dim":8,"songs":[]}"#).is_err());
        let broken = PackRecording { name: "x".into(), seconds: 1.0, windows: 2, embeddings: "AAAA".into(), part: None };
        assert!(broken.embeddings().is_err());
    }

    #[test]
    fn titles_match_loosely() {
        assert_eq!(title_key("No One Like the Lord!"), title_key("no one like the lord"));
        assert_eq!(loose_title_key("Holy Spirit (Live) [Official]"), title_key("Holy Spirit"));
        assert_eq!(loose_title_key("Firm Foundation (He Won't)"), title_key("Firm Foundation"));
    }
}
