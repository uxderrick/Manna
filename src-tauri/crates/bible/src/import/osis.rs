//! OSIS XML (`<osis><osisText><div type="book" osisID="Gen">…`).
//!
//! Verses are either containers (`<verse osisID="Gen.1.1">text</verse>`) or
//! milestones (`<verse sID="Gen.1.1" osisID="Gen.1.1"/>text<verse eID="Gen.1.1"/>`).
//! Notes, headings and variant readings are dropped; words inside `<w>`,
//! `<transChange>`, `<q>`, `<divineName>` and similar markup are kept.

use quick_xml::events::{BytesStart, Event};

use super::{books, xml, BibleFormat, Draft, ParsedBible};
use crate::error::BibleError;

/// Elements whose content is not verse text.
const SKIPPED: [&str; 3] = ["note", "title", "rdg"];
/// Elements that separate words even without whitespace around them.
const BREAKS: [&str; 4] = ["lb", "l", "p", "lg"];
/// `<work>` header fields captured as metadata.
const HEADER_FIELDS: [&str; 3] = ["title", "rights", "language"];

/// Book, chapter and verse from an `osisID` such as `Gen.1.1` (the first id
/// wins when several are listed, e.g. `"Gen.1.1 Gen.1.2"`).
fn reference(osis_id: &str) -> Option<(&str, i32, i32)> {
    let first = osis_id.split_whitespace().next()?;
    let mut parts = first.split('.');
    let book = parts.next()?;
    let chapter = xml::leading_number(parts.next()?)?;
    let verse = xml::leading_number(parts.next()?)?;
    Some((book, chapter, verse))
}

#[derive(Default)]
struct State {
    draft: Draft,
    /// `(book, chapter, verse, text)` of the verse being read.
    verse: Option<(i32, i32, i32, String)>,
    /// Depth inside elements listed in [`SKIPPED`].
    skip_depth: usize,
    in_header: bool,
    in_work: bool,
    work_seen: bool,
    header_field: Option<(String, String)>,
    /// Book div whose name may still come from a `<title short="…">`.
    naming_book: Option<i32>,
}

impl State {
    fn finish_verse(&mut self) {
        if let Some((book, chapter, verse, text)) = self.verse.take() {
            self.draft.push_verse(book, chapter, verse, &text);
        }
    }

    fn start_verse(&mut self, osis_id: &str) {
        self.finish_verse();
        let Some((book_id, chapter, verse)) = reference(osis_id) else {
            return;
        };
        match books::number_from_osis(book_id) {
            Some(book) => {
                self.naming_book = None;
                self.verse = Some((book, chapter, verse, String::new()));
            }
            None => self.draft.skip_book(book_id),
        }
    }

    fn element(&mut self, e: &BytesStart<'_>, empty: bool) {
        let name = xml::name(e);
        if self.in_header {
            self.header_element(&name, e, empty);
            return;
        }
        match name.as_str() {
            "osistext" => {
                let work = xml::attribute(e, "osisIDWork");
                Draft::set_if_empty(&mut self.draft.abbreviation, work.as_deref());
                let lang = xml::attribute(e, "lang");
                Draft::set_if_empty(&mut self.draft.language, lang.as_deref());
            }
            "header" if !empty => self.in_header = true,
            "div" => {
                let is_book = xml::attribute(e, "type").is_some_and(|t| t.eq_ignore_ascii_case("book"));
                if is_book {
                    let osis_id = xml::attribute(e, "osisID").unwrap_or_default();
                    match books::number_from_osis(&osis_id) {
                        Some(number) => self.naming_book = Some(number),
                        None => self.draft.skip_book(&osis_id),
                    }
                }
            }
            "verse" => {
                if xml::attribute(e, "eID").is_some() {
                    self.finish_verse();
                } else if let Some(id) = xml::attribute(e, "sID").or_else(|| xml::attribute(e, "osisID")) {
                    let osis_id = xml::attribute(e, "osisID").unwrap_or(id);
                    self.start_verse(&osis_id);
                }
            }
            "title" => {
                if let (Some(book), Some(short)) = (self.naming_book, xml::attribute(e, "short")) {
                    self.draft.name_book(book, Some(&short));
                    self.naming_book = None;
                }
                if !empty {
                    self.skip_depth += 1;
                }
            }
            _ if SKIPPED.contains(&name.as_str()) => {
                if !empty {
                    self.skip_depth += 1;
                }
            }
            _ if BREAKS.contains(&name.as_str()) => self.text(" "),
            _ => {}
        }
    }

    fn header_element(&mut self, name: &str, e: &BytesStart<'_>, empty: bool) {
        if name == "work" && !self.work_seen && !empty {
            self.in_work = true;
            let work = xml::attribute(e, "osisWork");
            Draft::set_if_empty(&mut self.draft.abbreviation, work.as_deref());
        } else if self.in_work && !empty && HEADER_FIELDS.contains(&name) {
            self.header_field = Some((name.to_owned(), String::new()));
        }
    }

    fn end(&mut self, name: &str) {
        if self.in_header {
            match name {
                "header" => self.in_header = false,
                "work" if self.in_work => {
                    self.in_work = false;
                    self.work_seen = true;
                }
                _ => self.end_header_field(name),
            }
            return;
        }
        if name == "verse" {
            self.finish_verse();
        } else if SKIPPED.contains(&name) {
            self.skip_depth = self.skip_depth.saturating_sub(1);
        } else if BREAKS.contains(&name) {
            self.text(" ");
        }
    }

    fn end_header_field(&mut self, name: &str) {
        if self.header_field.as_ref().is_none_or(|(field, _)| field != name) {
            return;
        }
        let Some((field, value)) = self.header_field.take() else {
            return;
        };
        let target = match field.as_str() {
            "title" => &mut self.draft.title,
            "rights" => &mut self.draft.copyright,
            _ => &mut self.draft.language,
        };
        Draft::set_if_empty(target, Some(&value));
    }

    fn text(&mut self, text: &str) {
        if let Some((_, value)) = &mut self.header_field {
            value.push_str(text);
        } else if self.skip_depth == 0 {
            if let Some((.., value)) = &mut self.verse {
                value.push_str(text);
            }
        }
    }
}

/// Parse an OSIS document. `file_stem` names the Bible when the header does not.
pub fn parse_osis(xml: &str, file_stem: &str) -> Result<ParsedBible, BibleError> {
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
    state.finish_verse();
    state.draft.finish(BibleFormat::Osis, file_stem)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CONTAINERS: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<osis xmlns="http://www.bibletechnologies.net/2003/OSIS/namespace">
  <osisText osisIDWork="TST" xml:lang="en">
    <header>
      <work osisWork="TST"><title>Test Bible</title><rights>Public Domain</rights></work>
      <work osisWork="Other"><title>Ignored</title></work>
    </header>
    <div type="book" osisID="Gen">
      <title type="main" short="Genesis">The First Book of Moses</title>
      <chapter osisID="Gen.1">
        <verse osisID="Gen.1.1"><w lemma="H7225">In the beginning</w> God created<note>a note</note> the heaven &amp; the earth.</verse>
        <verse osisID="Gen.1.2">And the earth was <transChange type="added">without</transChange> form.</verse>
      </chapter>
    </div>
    <div type="book" osisID="Tob"><chapter osisID="Tob.1"><verse osisID="Tob.1.1">Tobit</verse></chapter></div>
    <div type="book" osisID="John">
      <chapter osisID="John.3"><verse osisID="John.3.16"><q who="Jesus">For God so loved the world</q></verse></chapter>
    </div>
  </osisText>
</osis>"#;

    #[test]
    fn container_verses_keep_words_and_drop_notes() {
        let bible = parse_osis(CONTAINERS, "file").unwrap();
        assert_eq!(bible.abbreviation, "TST");
        assert_eq!(bible.title, "Test Bible");
        assert_eq!(bible.language, "en");
        assert_eq!(bible.copyright.as_deref(), Some("Public Domain"));
        assert_eq!(bible.skipped_books, vec!["Tob"]);
        assert_eq!(bible.books.len(), 2);
        let genesis = &bible.books[0];
        assert_eq!((genesis.number, genesis.name.as_str(), genesis.abbreviation.as_str()), (1, "Genesis", "Gen"));
        assert_eq!(genesis.testament, "OT");
        assert_eq!(genesis.verses[0].text, "In the beginning God created the heaven & the earth.");
        assert_eq!(genesis.verses[1].text, "And the earth was without form.");
        let john = &bible.books[1];
        assert_eq!((john.number, john.testament.as_str()), (43, "NT"));
        assert_eq!((john.verses[0].chapter, john.verses[0].verse), (3, 16));
        assert_eq!(john.verses[0].text, "For God so loved the world");
    }

    #[test]
    fn milestone_verses_end_at_eid_or_next_verse() {
        let xml = r#"<osis><osisText osisIDWork="MS">
          <div type="book" osisID="Ps"><chapter sID="Ps.23" osisID="Ps.23"/>
            <title type="psalm">A Psalm of David.</title>
            <verse sID="Ps.23.1" osisID="Ps.23.1"/>The <divineName>LORD</divineName> is my shepherd;<lb/>I shall not want.<verse eID="Ps.23.1"/>
            <title>Heading between verses</title>
            <verse sID="Ps.23.2" osisID="Ps.23.2"/>He maketh me to lie down
            <verse sID="Ps.23.3" osisID="Ps.23.3"/>He restoreth my soul<verse eID="Ps.23.3"/>
          <chapter eID="Ps.23"/></div></osisText></osis>"#;
        let bible = parse_osis(xml, "fallback").unwrap();
        assert_eq!(bible.abbreviation, "MS");
        let psalms = &bible.books[0];
        assert_eq!(psalms.number, 19);
        assert_eq!(psalms.name, "Psalms");
        let texts: Vec<_> = psalms.verses.iter().map(|v| (v.verse, v.text.as_str())).collect();
        assert_eq!(texts, vec![
            (1, "The LORD is my shepherd; I shall not want."),
            (2, "He maketh me to lie down"),
            (3, "He restoreth my soul"),
        ]);
    }

    #[test]
    fn document_without_canonical_verses_is_an_error() {
        let xml = r#"<osis><osisText><div type="book" osisID="Tob"><verse osisID="Tob.1.1">x</verse></div></osisText></osis>"#;
        assert!(parse_osis(xml, "x").is_err());
    }
}
