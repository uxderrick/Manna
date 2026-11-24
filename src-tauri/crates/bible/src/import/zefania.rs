//! Zefania XML (`<XMLBIBLE><BIBLEBOOK bnumber="1"><CHAPTER cnumber="1"><VERS vnumber="1">`).
//!
//! Book numbers 1–66 follow the Protestant canon; higher numbers are
//! deuterocanonical books and are skipped. Notes and cross-references are
//! dropped; Strong's (`<gr>`) and style markup keep their words.

use quick_xml::events::{BytesStart, Event};

use super::{books, xml, BibleFormat, Draft, ParsedBible};
use crate::error::BibleError;

/// Elements whose content is not verse text.
const SKIPPED: [&str; 3] = ["note", "xref", "media"];
/// `<INFORMATION>` fields captured as metadata.
const INFO_FIELDS: [&str; 4] = ["title", "identifier", "language", "rights"];

#[derive(Default)]
struct State {
    draft: Draft,
    /// `biblename` attribute, used when `<INFORMATION>` has no title.
    bible_name: Option<String>,
    book: Option<i32>,
    chapter: Option<i32>,
    verse: Option<(i32, String)>,
    skip_depth: usize,
    in_information: bool,
    info_field: Option<(String, String)>,
}

impl State {
    fn element(&mut self, e: &BytesStart<'_>, empty: bool) {
        let name = xml::name(e);
        match name.as_str() {
            "xmlbible" => self.bible_name = xml::attribute(e, "biblename"),
            "information" if !empty => self.in_information = true,
            _ if self.in_information && !empty && INFO_FIELDS.contains(&name.as_str()) => {
                self.info_field = Some((name, String::new()));
            }
            "biblebook" => self.start_book(e),
            "chapter" => self.chapter = xml::number(e, "cnumber"),
            "vers" if !empty => {
                self.verse = xml::number(e, "vnumber").map(|number| (number, String::new()));
            }
            "br" => self.text(" "),
            _ if SKIPPED.contains(&name.as_str()) && !empty => self.skip_depth += 1,
            _ => {}
        }
    }

    fn start_book(&mut self, e: &BytesStart<'_>) {
        let name = xml::attribute(e, "bname").filter(|n| !n.is_empty());
        let number = xml::number(e, "bnumber")
            .or_else(|| name.as_deref().and_then(books::number_from_name));
        self.chapter = None;
        // A repeated number is an apocryphal book filed under a canonical one.
        self.book = number
            .filter(|n| (1..=books::BOOK_COUNT).contains(n))
            .filter(|n| self.draft.books.get(n).is_none_or(|book| book.verses.is_empty()));
        if let Some(book) = self.book {
            self.draft.name_book(book, name.as_deref());
        } else {
            let label = name.unwrap_or_else(|| match number {
                Some(n) => format!("Book {n}"),
                None => "Unnamed book".to_owned(),
            });
            self.draft.skip_book(&label);
        }
    }

    fn end(&mut self, name: &str) {
        match name {
            "information" => self.in_information = false,
            "vers" => {
                if let (Some(book), Some(chapter), Some((verse, text))) =
                    (self.book, self.chapter, self.verse.take())
                {
                    self.draft.push_verse(book, chapter, verse, &text);
                }
            }
            "biblebook" => self.book = None,
            _ if SKIPPED.contains(&name) => self.skip_depth = self.skip_depth.saturating_sub(1),
            _ => {
                if self.info_field.as_ref().is_some_and(|(field, _)| field == name) {
                    if let Some((field, value)) = self.info_field.take() {
                        let target = match field.as_str() {
                            "title" => &mut self.draft.title,
                            "identifier" => &mut self.draft.abbreviation,
                            "language" => &mut self.draft.language,
                            _ => &mut self.draft.copyright,
                        };
                        Draft::set_if_empty(target, Some(&value));
                    }
                }
            }
        }
    }

    fn text(&mut self, text: &str) {
        if let Some((_, value)) = &mut self.info_field {
            value.push_str(text);
        } else if self.skip_depth == 0 {
            if let Some((_, value)) = &mut self.verse {
                value.push_str(text);
            }
        }
    }
}

/// Parse a Zefania document. `file_stem` names the Bible when the file does not.
pub fn parse_zefania(xml: &str, file_stem: &str) -> Result<ParsedBible, BibleError> {
    let mut reader = xml::reader(xml);
    let mut state = State::default();
    loop {
        let event = reader.read_event().map_err(|e| xml::parse_error(&reader, &e))?;
        match &event {
            Event::Start(e) => state.element(e, false),
            Event::Empty(e) => state.element(e, true),
            Event::End(e) => {
                let name = String::from_utf8_lossy(e.local_name().as_ref()).to_ascii_lowercase();
                state.end(&name);
            }
            Event::Eof => break,
            other => {
                if let Some(text) = xml::text(other) {
                    state.text(&text);
                }
            }
        }
    }
    Draft::set_if_empty(&mut state.draft.title, state.bible_name.as_deref());
    state.draft.finish(BibleFormat::Zefania, file_stem)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn books_chapters_and_metadata_are_read() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
<XMLBIBLE biblename="Schlachter 1951" type="x-bible">
  <INFORMATION>
    <title>Schlachter Bibel</title>
    <identifier>SCH51</identifier>
    <language>GER</language>
    <rights>Copyright (c) Genfer Bibelgesellschaft</rights>
  </INFORMATION>
  <BIBLEBOOK bnumber="1" bname="1. Mose">
    <CHAPTER cnumber="1">
      <CAPTION>Die Schöpfung</CAPTION>
      <VERS vnumber="1">Im Anfang schuf <gr str="430">Gott</gr> den Himmel<NOTE>Fußnote</NOTE> und die Erde.</VERS>
      <VERS vnumber="2">Und die Erde<BR/>war wüst.</VERS>
    </CHAPTER>
  </BIBLEBOOK>
  <BIBLEBOOK bnumber="67" bname="Judit"><CHAPTER cnumber="1"><VERS vnumber="1">x</VERS></CHAPTER></BIBLEBOOK>
  <BIBLEBOOK bnumber="66" bname="Offenbarung"><CHAPTER cnumber="22"><VERS vnumber="21">Amen.</VERS></CHAPTER></BIBLEBOOK>
</XMLBIBLE>"#;
        let bible = parse_zefania(xml, "file").unwrap();
        assert_eq!(bible.title, "Schlachter Bibel");
        assert_eq!(bible.abbreviation, "SCH51");
        assert_eq!(bible.language, "de");
        assert_eq!(bible.copyright.as_deref(), Some("Copyright (c) Genfer Bibelgesellschaft"));
        assert_eq!(bible.skipped_books, vec!["Judit"]);
        assert_eq!(bible.books.len(), 2);
        assert_eq!(bible.books[0].name, "1. Mose");
        assert_eq!(bible.books[0].abbreviation, "Gen");
        assert_eq!(bible.books[0].verses[0].text, "Im Anfang schuf Gott den Himmel und die Erde.");
        assert_eq!(bible.books[0].verses[1].text, "Und die Erde war wüst.");
        assert_eq!(bible.books[1].number, 66);
        assert_eq!((bible.books[1].verses[0].chapter, bible.books[1].verses[0].verse), (22, 21));
    }

    #[test]
    fn missing_information_falls_back_to_bible_name() {
        let xml = r#"<XMLBIBLE biblename="King James Version"><BIBLEBOOK bnumber="43"><CHAPTER cnumber="3"><VERS vnumber="16">For God so loved the world</VERS></CHAPTER></BIBLEBOOK></XMLBIBLE>"#;
        let bible = parse_zefania(xml, "kjv_zefania").unwrap();
        assert_eq!(bible.title, "King James Version");
        assert_eq!(bible.abbreviation, "kjvzefania");
        assert_eq!(bible.language, "en");
        assert_eq!(bible.books[0].name, "John");
    }
}
