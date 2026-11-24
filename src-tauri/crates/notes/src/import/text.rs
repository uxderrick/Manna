//! Text helpers shared by the importers.

use super::SectionKind;

/// Windows-1252 code points for bytes 0x80..=0x9F (the rest match Latin-1).
const CP1252_HIGH: [char; 32] = [
    '\u{20AC}', '\u{FFFD}', '\u{201A}', '\u{0192}', '\u{201E}', '\u{2026}', '\u{2020}', '\u{2021}',
    '\u{02C6}', '\u{2030}', '\u{0160}', '\u{2039}', '\u{0152}', '\u{FFFD}', '\u{017D}', '\u{FFFD}',
    '\u{FFFD}', '\u{2018}', '\u{2019}', '\u{201C}', '\u{201D}', '\u{2022}', '\u{2013}', '\u{2014}',
    '\u{02DC}', '\u{2122}', '\u{0161}', '\u{203A}', '\u{0153}', '\u{FFFD}', '\u{017E}', '\u{0178}',
];

pub fn cp1252_char(byte: u8) -> char {
    match byte {
        0x80..=0x9F => CP1252_HIGH[usize::from(byte - 0x80)],
        _ => char::from(byte),
    }
}

/// Decode a text file the way song exports are found in the wild:
/// UTF-8 (with or without BOM), UTF-16 with BOM, else Windows-1252.
pub fn decode_text(bytes: &[u8]) -> String {
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8_lossy(rest).into_owned();
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        return decode_utf16(rest, u16::from_le_bytes);
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        return decode_utf16(rest, u16::from_be_bytes);
    }
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        Err(_) => bytes.iter().map(|&b| cp1252_char(b)).collect(),
    }
}

fn decode_utf16(bytes: &[u8], read: fn([u8; 2]) -> u16) -> String {
    let units: Vec<u16> = bytes.as_chunks::<2>().0.iter().map(|&pair| read(pair)).collect();
    String::from_utf16_lossy(&units)
}

/// Recognise a section heading such as `Verse 1`, `Chorus 2`, `[Bridge]`,
/// `Pre-Chorus:`. Returns `None` for ordinary lyric lines.
pub fn section_label(line: &str) -> Option<SectionKind> {
    let trimmed = line
        .trim()
        .trim_matches(|c| matches!(c, '[' | ']' | '(' | ')' | '{' | '}'))
        .trim_end_matches(':')
        .trim();
    if trimmed.is_empty() || trimmed.len() > 24 {
        return None;
    }
    let lower = trimmed.to_lowercase();
    // Word part, then an optional number / letter suffix ("Verse 1", "Chorus 2a").
    let word_end = lower
        .find(|c: char| c.is_ascii_digit())
        .unwrap_or(lower.len());
    let (word, suffix) = lower.split_at(word_end);
    let word = word.trim();
    let suffix_ok = suffix
        .trim()
        .chars()
        .all(|c| c.is_ascii_alphanumeric());
    if !suffix_ok {
        return None;
    }
    match word {
        "verse" | "vers" | "stanza" => Some(SectionKind::Verse),
        "chorus" | "refrain" => Some(SectionKind::Chorus),
        "bridge" | "pre-chorus" | "pre chorus" | "prechorus" | "tag" | "intro" | "outro"
        | "ending" | "interlude" | "instrumental" | "vamp" | "misc" | "turnaround" | "coda"
        | "channel" | "post-chorus" | "post chorus" => Some(SectionKind::Other),
        _ => None,
    }
}

/// Trim lines and drop empty ones.
pub fn clean_lines<'a>(lines: impl IntoIterator<Item = &'a str>) -> Vec<String> {
    lines
        .into_iter()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(str::to_string)
        .collect()
}

/// Lowercase ASCII slug for ids (`"Way Maker!"` → `"way-maker"`).
pub fn slug(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars().flat_map(char::to_lowercase) {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    out.trim_end_matches('-').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels() {
        assert_eq!(section_label("Verse 1"), Some(SectionKind::Verse));
        assert_eq!(section_label("[Chorus 2]"), Some(SectionKind::Chorus));
        assert_eq!(section_label("Pre-Chorus:"), Some(SectionKind::Other));
        assert_eq!(section_label("Bridge"), Some(SectionKind::Other));
        assert_eq!(section_label("Verse of praise and joy"), None);
        assert_eq!(section_label("Amazing grace"), None);
        assert_eq!(section_label(""), None);
    }

    #[test]
    fn decodes_bom_and_cp1252() {
        assert_eq!(decode_text(b"\xEF\xBB\xBFhi"), "hi");
        assert_eq!(decode_text(b"\xFF\xFEh\x00i\x00"), "hi");
        assert_eq!(decode_text(b"\x93Lord\x94 \xA9"), "\u{201C}Lord\u{201D} \u{A9}");
    }

    #[test]
    fn slugs() {
        assert_eq!(slug("Way Maker!"), "way-maker");
        assert_eq!(slug("  Goodness of God  "), "goodness-of-god");
    }
}
