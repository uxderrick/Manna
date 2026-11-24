//! OpenSong XML (`<bible><b n="Genesis"><c n="1"><v n="1">text</v>`).
//!
//! The format carries no book numbers. English book names are matched to the
//! canon; when no name matches (e.g. a non-English Bible) books are numbered
//! by position. When some names match, unmatched books are treated as
//! deuterocanonical and skipped.

use quick_xml::events::{BytesStart, Event};

use super::{books, xml, BibleFormat, Draft, ParsedBible, ParsedVerse};
use crate::error::BibleError;

#[derive(Default)]
struct SourceBook {
    name: String,
    verses: Vec<ParsedVerse>,
}

#[derive(Default)]
struct State {
    title: Option<String>,
    books: Vec<SourceBook>,
    chapter: Option<i32>,
    verse: Option<(i32, String)>,
}

impl State {
    fn element(&mut self, e: &BytesStart<'_>, empty: bool) {
        match xml::name(e).as_str() {
            "bible" => self.title = xml::attribute(e, "n").or_else(|| xml::attribute(e, "name")),
            "b" => {
                self.chapter = None;
                self.books.push(SourceBook {
                    name: xml::attribute(e, "n").unwrap_or_default(),
                    verses: Vec::new(),
                });
            }
            "c" => self.chapter = xml::number(e, "n"),
            "v" if !empty => self.verse = xml::number(e, "n").map(|n| (n, String::new())),
            _ => {}
        }
    }

    fn end(&mut self, name: &[u8]) {
        if !name.eq_ignore_ascii_case(b"v") {
            return;
        }
        if let (Some(chapter), Some((verse, text)), Some(book)) =
            (self.chapter, self.verse.take(), self.books.last_mut())
        {
            book.verses.push(ParsedVerse { chapter, verse, text });
        }
    }
}

/// Parse an OpenSong Bible. OpenSong files have no metadata, so `file_stem`
/// usually becomes the title and abbreviation.
pub fn parse_opensong(xml: &str, file_stem: &str) -> Result<ParsedBible, BibleError> {
    let mut reader = xml::reader(xml);
    let mut state = State::default();
    loop {
        let event = reader.read_event().map_err(|e| xml::parse_error(&reader, &e))?;
        match &event {
            Event::Start(e) => state.element(e, false),
            Event::Empty(e) => state.element(e, true),
            Event::End(e) => state.end(e.local_name().as_ref()),
            Event::Eof => break,
            other => {
                if let (Some(text), Some((_, value))) = (xml::text(other), &mut state.verse) {
                    value.push_str(&text);
                }
            }
        }
    }

    let matched: Vec<Option<i32>> = state
        .books
        .iter()
        .map(|book| books::number_from_name(&book.name))
        .collect();
    let any_matched = matched.iter().any(Option::is_some);
    let mut draft = Draft { title: state.title, ..Draft::default() };
    for (position, (book, by_name)) in state.books.into_iter().zip(matched).enumerate() {
        let by_position = i32::try_from(position + 1).ok().filter(|n| *n <= books::BOOK_COUNT);
        let number = if any_matched { by_name } else { by_position };
        let Some(number) = number else {
            let label = if book.name.is_empty() { format!("Book {}", position + 1) } else { book.name };
            draft.skip_book(&label);
            continue;
        };
        draft.name_book(number, Some(&book.name));
        for verse in book.verses {
            draft.push_verse(number, verse.chapter, verse.verse, &verse.text);
        }
    }
    draft.finish(BibleFormat::OpenSong, file_stem)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn english_names_map_to_canon_and_skip_others() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<bible>
  <b n="Genesis"><c n="1"><v n="1">In the beginning God created the heaven and the earth.</v><v n="2">And the earth was without form.</v></c></b>
  <b n="Tobit"><c n="1"><v n="1">The book of the words of Tobit</v></c></b>
  <b n="Revelation"><c n="22"><v n="21">The grace of our Lord Jesus Christ be with you all. Amen.</v></c></b>
</bible>"#;
        let bible = parse_opensong(xml, "KJV_OpenSong").unwrap();
        assert_eq!(bible.title, "KJV OpenSong");
        assert_eq!(bible.abbreviation, "KJVOpenSong");
        assert_eq!(bible.language, "en");
        assert_eq!(bible.skipped_books, vec!["Tobit"]);
        let numbers: Vec<_> = bible.books.iter().map(|b| b.number).collect();
        assert_eq!(numbers, vec![1, 66]);
        assert_eq!(bible.books[0].verses.len(), 2);
        assert_eq!(bible.books[1].abbreviation, "Rev");
    }

    #[test]
    fn unknown_names_are_numbered_by_position() {
        let xml = r#"<bible><b n="Mwanzo"><c n="1"><v n="1">Hapo mwanzo</v></c></b><b n="Kutoka"><c n="1"><v n="1">Basi</v></c></b></bible>"#;
        let bible = parse_opensong(xml, "SWA").unwrap();
        assert_eq!(bible.abbreviation, "SWA");
        assert_eq!(bible.language, "und");
        let books: Vec<_> = bible.books.iter().map(|b| (b.number, b.name.as_str())).collect();
        assert_eq!(books, vec![(1, "Mwanzo"), (2, "Kutoka")]);
    }
}
