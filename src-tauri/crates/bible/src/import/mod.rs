//! Parsers for Bibles exported by other worship software.
//!
//! Each parser turns a foreign file into a [`ParsedBible`] without touching
//! Manna's databases, so they stay unit-testable. [`crate::BibleDb::import_bible`]
//! writes the result into the user Bible database.
//!
//! Supported formats: OpenLP Bible databases (`*.sqlite`), OSIS XML,
//! Zefania XML and OpenSong XML. Only the 66 books of the Protestant canon
//! are imported; other books (deuterocanon/apocrypha) are listed in
//! [`ParsedBible::skipped_books`].

// Product names (OpenLP, OpenSong) read as code to this lint.
#![allow(clippy::doc_markdown)]

pub mod books;
mod openlp;
mod opensong;
mod osis;
mod xml;
mod zefania;

use std::collections::BTreeMap;
use std::io::Read;
use std::path::Path;

use serde::Serialize;

use crate::error::BibleError;

pub use openlp::parse_openlp;
pub use opensong::parse_opensong;
pub use osis::parse_osis;
pub use zefania::parse_zefania;

/// Source format of an imported Bible.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BibleFormat {
    OpenLp,
    Osis,
    Zefania,
    OpenSong,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedVerse {
    pub chapter: i32,
    pub verse: i32,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedBook {
    /// Canonical book number, 1 (Genesis) ..= 66 (Revelation).
    pub number: i32,
    /// Name from the source, or the default English name.
    pub name: String,
    /// Bundled-style abbreviation (`Gen`, `1Kgs`, `Rev`…).
    pub abbreviation: String,
    /// `"OT"` or `"NT"`, as in the bundled database.
    pub testament: String,
    /// Ordered by chapter then verse, without duplicates.
    pub verses: Vec<ParsedVerse>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedBible {
    pub format: BibleFormat,
    pub abbreviation: String,
    pub title: String,
    /// ISO 639-1 code where known (`"en"`), otherwise `"und"`.
    pub language: String,
    pub copyright: Option<String>,
    /// Ordered by book number.
    pub books: Vec<ParsedBook>,
    /// Names of books in the source that are not in the 66-book canon.
    pub skipped_books: Vec<String>,
}

impl ParsedBible {
    pub fn verse_count(&self) -> usize {
        self.books.iter().map(|book| book.verses.len()).sum()
    }
}

/// Parse any supported Bible file, detecting the format from its content.
pub fn parse_bible_file(path: &Path) -> Result<ParsedBible, BibleError> {
    let mut magic = [0_u8; 16];
    let read = std::fs::File::open(path)?.read(&mut magic)?;
    if magic[..read] == *b"SQLite format 3\0" {
        return parse_openlp(path);
    }
    let text = decode_text(&std::fs::read(path)?);
    parse_bible_xml(&text, &file_stem(path))
}

/// Parse an OSIS, Zefania or OpenSong document, detected by its root element.
/// `file_stem` supplies a name when the document has none.
pub fn parse_bible_xml(xml: &str, file_stem: &str) -> Result<ParsedBible, BibleError> {
    match xml::root_element(xml)?.as_str() {
        "osis" => parse_osis(xml, file_stem),
        "xmlbible" => parse_zefania(xml, file_stem),
        "bible" => parse_opensong(xml, file_stem),
        other => Err(BibleError::Parse(format!(
            "unsupported Bible format (XML root <{other}>); expected OSIS, Zefania or OpenSong"
        ))),
    }
}

fn file_stem(path: &Path) -> String {
    path.file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Decode a text file: UTF-8 (with or without BOM), UTF-16 with BOM, or
/// Latin-1 as a last resort for legacy files.
fn decode_text(bytes: &[u8]) -> String {
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8_lossy(rest).into_owned();
    }
    let utf16 = |rest: &[u8], big_endian: bool| {
        let units: Vec<u16> = rest
            .as_chunks::<2>()
            .0
            .iter()
            .map(|&pair| {
                if big_endian {
                    u16::from_be_bytes(pair)
                } else {
                    u16::from_le_bytes(pair)
                }
            })
            .collect();
        String::from_utf16_lossy(&units)
    };
    if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        return utf16(rest, false);
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        return utf16(rest, true);
    }
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_owned(),
        Err(_) => bytes.iter().map(|&byte| char::from(byte)).collect(),
    }
}

/// Collapse runs of whitespace (including newlines) to single spaces.
fn clean_text(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Metadata and verses collected by a parser before normalization.
#[derive(Debug, Default)]
struct Draft {
    title: Option<String>,
    abbreviation: Option<String>,
    language: Option<String>,
    copyright: Option<String>,
    books: BTreeMap<i32, DraftBook>,
    skipped: Vec<String>,
}

#[derive(Debug, Default)]
struct DraftBook {
    name: Option<String>,
    verses: Vec<ParsedVerse>,
}

impl Draft {
    fn set_if_empty(field: &mut Option<String>, value: Option<&str>) {
        let value = value.map(str::trim).filter(|v| !v.is_empty());
        if field.is_none() {
            *field = value.map(clean_text);
        }
    }

    /// Record a canonical book's source name, keeping the first one seen.
    fn name_book(&mut self, number: i32, name: Option<&str>) {
        let book = self.books.entry(number).or_default();
        Self::set_if_empty(&mut book.name, name);
    }

    fn push_verse(&mut self, book: i32, chapter: i32, verse: i32, text: &str) {
        let text = clean_text(text);
        if text.is_empty() || chapter < 1 || verse < 1 {
            return;
        }
        self.books
            .entry(book)
            .or_default()
            .verses
            .push(ParsedVerse { chapter, verse, text });
    }

    fn skip_book(&mut self, name: &str) {
        let name = name.trim();
        if !name.is_empty() && !self.skipped.iter().any(|seen| seen == name) {
            self.skipped.push(name.to_owned());
        }
    }

    fn finish(self, format: BibleFormat, file_stem: &str) -> Result<ParsedBible, BibleError> {
        let mut books = Vec::new();
        let mut names_from_source = 0_usize;
        let mut english_names = 0_usize;
        for (number, draft) in self.books {
            let (Some(default_name), Some(abbreviation)) =
                (books::default_name(number), books::default_abbreviation(number))
            else {
                continue;
            };
            if draft.verses.is_empty() {
                continue;
            }
            if let Some(name) = &draft.name {
                names_from_source += 1;
                if books::number_from_name(name) == Some(number) {
                    english_names += 1;
                }
            }
            books.push(ParsedBook {
                number,
                name: draft.name.unwrap_or_else(|| default_name.to_owned()),
                abbreviation: abbreviation.to_owned(),
                testament: books::testament(number).to_owned(),
                verses: merge_duplicate_verses(draft.verses),
            });
        }
        if books.is_empty() {
            return Err(BibleError::Parse(
                "no verses from the 66 canonical books were found".to_owned(),
            ));
        }

        let title = self
            .title
            .clone()
            .or_else(|| self.abbreviation.clone())
            .unwrap_or_else(|| clean_text(&file_stem.replace('_', " ")));
        let abbreviation = derive_abbreviation(self.abbreviation.as_deref(), &title, file_stem);
        let title = if title.is_empty() { abbreviation.clone() } else { title };
        let language = self
            .language
            .as_deref()
            .and_then(normalize_language)
            .unwrap_or_else(|| {
                // Without a declared language, English book names suggest English.
                let english = names_from_source == 0 || english_names * 2 >= names_from_source;
                if english { "en" } else { "und" }.to_owned()
            });

        Ok(ParsedBible {
            format,
            abbreviation,
            title,
            language,
            copyright: self.copyright,
            books,
            skipped_books: self.skipped,
        })
    }
}

/// Sort by chapter and verse; join verses that appear more than once.
fn merge_duplicate_verses(mut verses: Vec<ParsedVerse>) -> Vec<ParsedVerse> {
    verses.sort_by_key(|v| (v.chapter, v.verse));
    let mut merged: Vec<ParsedVerse> = Vec::with_capacity(verses.len());
    for verse in verses {
        match merged.last_mut() {
            Some(last) if last.chapter == verse.chapter && last.verse == verse.verse => {
                last.text.push(' ');
                last.text.push_str(&verse.text);
            }
            _ => merged.push(verse),
        }
    }
    merged
}

const MAX_ABBREVIATION: usize = 12;

/// A short translation code: the source's own if it has one, else the title
/// when it is a single short word, else the file name, else the title's initials.
fn derive_abbreviation(explicit: Option<&str>, title: &str, file_stem: &str) -> String {
    let single_word = |value: &str| {
        let value = value.trim();
        (!value.is_empty()
            && value.chars().count() <= MAX_ABBREVIATION
            && !value.contains(char::is_whitespace))
        .then(|| value.to_owned())
    };
    let alphanumeric = |value: &str| -> String { value.chars().filter(|c| c.is_alphanumeric()).collect() };
    if let Some(found) = explicit.and_then(single_word).or_else(|| single_word(title)) {
        return found;
    }
    let stem = alphanumeric(file_stem);
    if !stem.is_empty() && stem.chars().count() <= MAX_ABBREVIATION {
        return stem;
    }
    let initials: String = title
        .split(|c: char| !c.is_alphanumeric())
        .filter_map(|word| word.chars().next())
        .flat_map(char::to_uppercase)
        .collect();
    if initials.chars().count() >= 2 {
        return initials.chars().take(MAX_ABBREVIATION).collect();
    }
    let fallback: String = alphanumeric(title).chars().take(MAX_ABBREVIATION).collect();
    if fallback.is_empty() {
        "IMPORTED".to_owned()
    } else {
        fallback
    }
}

/// ISO 639-1 code for a language tag, ISO 639-2 code or English/native name.
fn normalize_language(value: &str) -> Option<String> {
    const NAMES: [(&str, &str); 52] = [
        ("eng", "en"), ("english", "en"),
        ("deu", "de"), ("ger", "de"), ("german", "de"), ("deutsch", "de"),
        ("fra", "fr"), ("fre", "fr"), ("french", "fr"), ("français", "fr"),
        ("spa", "es"), ("spanish", "es"), ("español", "es"),
        ("por", "pt"), ("portuguese", "pt"), ("português", "pt"),
        ("ita", "it"), ("italian", "it"), ("nld", "nl"), ("dut", "nl"), ("dutch", "nl"),
        ("rus", "ru"), ("russian", "ru"), ("ukr", "uk"), ("pol", "pl"), ("ces", "cs"),
        ("cze", "cs"), ("hun", "hu"), ("ron", "ro"), ("rum", "ro"), ("swe", "sv"),
        ("nor", "no"), ("dan", "da"), ("fin", "fi"), ("ell", "el"), ("gre", "el"),
        ("heb", "he"), ("ara", "ar"), ("zho", "zh"), ("chi", "zh"), ("kor", "ko"),
        ("jpn", "ja"), ("vie", "vi"), ("ind", "id"), ("tgl", "tl"), ("swa", "sw"),
        ("afr", "af"), ("yor", "yo"), ("ibo", "ig"), ("hau", "ha"), ("zul", "zu"),
        ("lat", "la"),
    ];
    let lower = value.trim().to_lowercase();
    let primary = lower.split(['-', '_']).next().unwrap_or_default();
    if let Some((_, code)) = NAMES.iter().find(|(name, _)| *name == primary) {
        return Some((*code).to_owned());
    }
    let is_code = (2..=3).contains(&primary.len()) && primary.chars().all(|c| c.is_ascii_lowercase());
    is_code.then(|| primary.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_whitespace_is_collapsed() {
        assert_eq!(clean_text("  In the\n beginning,  God. "), "In the beginning, God.");
    }

    #[test]
    fn abbreviations_prefer_short_codes() {
        assert_eq!(derive_abbreviation(Some("KJV"), "King James", "x"), "KJV");
        assert_eq!(derive_abbreviation(None, "ASV", "ASV"), "ASV");
        assert_eq!(derive_abbreviation(None, "KJV (Red Letter)", "KJVRLE"), "KJVRLE");
        assert_eq!(
            derive_abbreviation(None, "World English Bible", "World_English_Bible"),
            "WEB"
        );
    }

    #[test]
    fn languages_normalize_to_two_letter_codes() {
        assert_eq!(normalize_language("en-US").as_deref(), Some("en"));
        assert_eq!(normalize_language("ENG").as_deref(), Some("en"));
        assert_eq!(normalize_language("Deutsch").as_deref(), Some("de"));
        assert_eq!(normalize_language("Klingon language"), None);
    }

    #[test]
    fn decodes_bom_and_legacy_encodings() {
        assert_eq!(decode_text(b"\xEF\xBB\xBF<a/>"), "<a/>");
        assert_eq!(decode_text(b"\xFF\xFE<\0a\0/\0>\0"), "<a/>");
        assert_eq!(decode_text(b"caf\xE9"), "café");
    }

    #[test]
    fn duplicate_verses_are_joined_in_order() {
        let verse = |verse, text: &str| ParsedVerse { chapter: 1, verse, text: text.to_owned() };
        let merged = merge_duplicate_verses(vec![verse(2, "b"), verse(1, "a"), verse(2, "c")]);
        assert_eq!(merged, vec![verse(1, "a"), verse(2, "b c")]);
    }

    #[test]
    fn unknown_xml_root_is_rejected() {
        let error = parse_bible_xml("<html><body/></html>", "page").unwrap_err();
        assert!(error.to_string().contains("<html>"), "{error}");
    }
}
