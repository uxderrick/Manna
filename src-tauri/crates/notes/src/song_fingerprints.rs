//! Song fingerprints for detection by sound.
//!
//! Each row is one reference recording of a song, stored as its embeddings
//! (little-endian `f32`, `dim` values per window), never the audio itself.
//! `model` names the embedding model, so fingerprints from another model
//! are ignored rather than compared. Deleting a song deletes its
//! fingerprints.

use rusqlite::params;
use serde::Serialize;

use crate::{Result, SessionDb, SessionError};

/// A stored reference: `source` is `library` (shipped), `operator` (added
/// from a recording) or `live` (learned from a confirmed performance).
#[derive(Debug, Clone, PartialEq)]
pub struct SongFingerprint {
    pub id: String,
    pub song_id: String,
    pub source: String,
    pub model: String,
    pub embeddings: Vec<Vec<f32>>,
}

/// What the UI lists: everything except the vectors.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SongFingerprintInfo {
    pub id: String,
    pub song_id: String,
    pub source: String,
    pub model: String,
    pub windows: i64,
    pub created_at: String,
}

fn encode(embeddings: &[Vec<f32>]) -> Result<(i64, Vec<u8>)> {
    let dim = embeddings.first().map_or(0, Vec::len);
    if embeddings.iter().any(|e| e.len() != dim) {
        return Err(SessionError::InvalidInput("fingerprint windows differ in size".into()));
    }
    let bytes = embeddings.iter().flatten().flat_map(|x| x.to_le_bytes()).collect();
    let dim = i64::try_from(dim).map_err(|_| SessionError::InvalidInput("fingerprint too large".into()))?;
    Ok((dim, bytes))
}

fn decode(dim: i64, bytes: &[u8]) -> Vec<Vec<f32>> {
    let dim = usize::try_from(dim).unwrap_or(0);
    if dim == 0 {
        return Vec::new();
    }
    let floats: Vec<f32> = bytes.as_chunks::<4>().0.iter().map(|b| f32::from_le_bytes(*b)).collect();
    floats.chunks_exact(dim).map(<[f32]>::to_vec).collect()
}

impl SessionDb {
    pub(crate) fn migrate_song_fingerprints(&self) -> Result<()> {
        self.conn().execute_batch(
            "CREATE TABLE IF NOT EXISTS song_fingerprints (
                id TEXT PRIMARY KEY,
                song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
                source TEXT NOT NULL CHECK (source IN ('library', 'operator', 'live')),
                model TEXT NOT NULL,
                dim INTEGER NOT NULL,
                windows INTEGER NOT NULL,
                embeddings BLOB NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_song_fingerprints_song ON song_fingerprints(song_id);
            CREATE INDEX IF NOT EXISTS idx_song_fingerprints_model ON song_fingerprints(model);",
        )?;
        Ok(())
    }

    /// Insert or replace a fingerprint (by id).
    pub fn save_song_fingerprint(&self, fp: &SongFingerprint) -> Result<()> {
        if fp.embeddings.is_empty() {
            return Err(SessionError::InvalidInput("a fingerprint needs at least one window".into()));
        }
        let (dim, bytes) = encode(&fp.embeddings)?;
        let windows = i64::try_from(fp.embeddings.len()).unwrap_or(i64::MAX);
        self.conn().execute(
            "INSERT INTO song_fingerprints (id, song_id, source, model, dim, windows, embeddings)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
                song_id = excluded.song_id, source = excluded.source, model = excluded.model,
                dim = excluded.dim, windows = excluded.windows, embeddings = excluded.embeddings,
                created_at = datetime('now')",
            params![fp.id, fp.song_id, fp.source, fp.model, dim, windows, bytes],
        )?;
        Ok(())
    }

    /// Every fingerprint made with `model`, oldest first (so live references
    /// load in the order they were learned).
    pub fn list_song_fingerprints(&self, model: &str) -> Result<Vec<SongFingerprint>> {
        let mut stmt = self.conn().prepare(
            "SELECT id, song_id, source, model, dim, embeddings FROM song_fingerprints
             WHERE model = ?1 ORDER BY created_at, rowid",
        )?;
        let rows = stmt.query_map(params![model], |row| {
            let bytes: Vec<u8> = row.get(5)?;
            Ok(SongFingerprint {
                id: row.get(0)?,
                song_id: row.get(1)?,
                source: row.get(2)?,
                model: row.get(3)?,
                embeddings: decode(row.get(4)?, &bytes),
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Fingerprints without their vectors, optionally for one song.
    pub fn song_fingerprint_info(&self, song_id: Option<&str>) -> Result<Vec<SongFingerprintInfo>> {
        let mut stmt = self.conn().prepare(
            "SELECT id, song_id, source, model, windows, created_at FROM song_fingerprints
             WHERE ?1 IS NULL OR song_id = ?1 ORDER BY song_id, created_at, rowid",
        )?;
        let rows = stmt.query_map(params![song_id], |row| {
            Ok(SongFingerprintInfo {
                id: row.get(0)?,
                song_id: row.get(1)?,
                source: row.get(2)?,
                model: row.get(3)?,
                windows: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn delete_song_fingerprints(&self, ids: &[String]) -> Result<usize> {
        let mut deleted = 0;
        for id in ids {
            deleted += self.conn().execute("DELETE FROM song_fingerprints WHERE id = ?1", params![id])?;
        }
        Ok(deleted)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_embeddings() {
        let e = vec![vec![1.0, -0.5, 0.25], vec![0.0, 2.0, -3.0]];
        let (dim, bytes) = encode(&e).unwrap();
        assert_eq!(dim, 3);
        assert_eq!(decode(dim, &bytes), e);
        assert!(encode(&[vec![1.0], vec![1.0, 2.0]]).is_err());
    }
}
