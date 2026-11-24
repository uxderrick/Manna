//! Zip helpers for service/playlist bundles (`.osz`, `.ewsx`, `.pro6plx`,
//! `.proPlaylist`).

use std::fs::File;
use std::io::Read;
use std::path::Path;

use zip::ZipArchive;

/// Refuse to inflate entries bigger than this (a service bundle's text parts
/// are tiny; this only guards against zip bombs).
const MAX_ENTRY_BYTES: u64 = 256 * 1024 * 1024;

pub struct Archive {
    zip: ZipArchive<File>,
}

impl Archive {
    pub fn open(path: &Path) -> Result<Self, String> {
        let file = File::open(path).map_err(|e| format!("Could not open {}: {e}", path.display()))?;
        let zip = ZipArchive::new(file).map_err(|e| format!("{} is not a valid bundle ({e})", path.display()))?;
        Ok(Self { zip })
    }

    pub fn names(&self) -> Vec<String> {
        self.zip.file_names().map(str::to_string).collect()
    }

    /// First entry whose file name (ignoring folders) satisfies `pred`.
    pub fn find(&self, pred: impl Fn(&str) -> bool) -> Option<String> {
        let mut names = self.names();
        names.sort();
        names.into_iter().find(|n| pred(base_name(n)))
    }

    /// Read a whole entry. EasyWorship writes `.ewsx` files with a wrong
    /// CRC; the zip reader reports that only after the last byte, so a
    /// checksum error with every byte read is accepted (OpenLP does the same).
    pub fn read(&mut self, name: &str) -> Result<Vec<u8>, String> {
        let mut entry = self.zip.by_name(name).map_err(|e| format!("{name}: {e}"))?;
        let size = entry.size();
        if size > MAX_ENTRY_BYTES {
            return Err(format!("{name} is too large ({size} bytes)"));
        }
        let mut buf = Vec::with_capacity(usize::try_from(size).unwrap_or(0));
        match entry.read_to_end(&mut buf) {
            Ok(_) => Ok(buf),
            Err(_) if buf.len() as u64 == size => Ok(buf),
            Err(e) => Err(format!("{name}: {e}")),
        }
    }
}

/// Last path component of a zip entry name (`/` or `\` separated).
pub fn base_name(name: &str) -> &str {
    name.rsplit(['/', '\\']).next().unwrap_or(name)
}

/// File stem of a zip entry or path string.
pub fn stem(name: &str) -> &str {
    let base = base_name(name);
    base.rsplit_once('.').map_or(base, |(s, _)| s)
}

#[cfg(test)]
pub(crate) fn write_zip(path: &Path, entries: &[(&str, &[u8])]) {
    use std::io::Write;
    let mut zip = zip::ZipWriter::new(File::create(path).unwrap());
    for (name, data) in entries {
        zip.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
        zip.write_all(data).unwrap();
    }
    zip.finish().unwrap();
}
