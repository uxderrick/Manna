//! Small helpers shared by the XML Bible parsers.

use std::borrow::Cow;

use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;

use crate::error::BibleError;

/// A lenient reader: Bible exports in the wild often have mismatched end tags.
pub(super) fn reader(xml: &str) -> Reader<&[u8]> {
    let mut reader = Reader::from_reader(xml.as_bytes());
    reader.config_mut().check_end_names = false;
    reader
}

pub(super) fn parse_error(reader: &Reader<&[u8]>, error: &quick_xml::Error) -> BibleError {
    BibleError::Parse(format!(
        "invalid XML near byte {}: {error}",
        reader.buffer_position()
    ))
}

/// Lower-case local name (namespace prefix removed) of the document's root element.
pub(super) fn root_element(xml: &str) -> Result<String, BibleError> {
    let mut reader = reader(xml);
    loop {
        match reader.read_event() {
            Ok(Event::Start(e) | Event::Empty(e)) => return Ok(name(&e)),
            Ok(Event::Eof) => {
                return Err(BibleError::Parse("the file contains no XML elements".to_owned()))
            }
            Ok(_) => {}
            Err(error) => return Err(parse_error(&reader, &error)),
        }
    }
}

/// Lower-case local name of an element.
pub(super) fn name(element: &BytesStart<'_>) -> String {
    String::from_utf8_lossy(element.local_name().as_ref()).to_ascii_lowercase()
}

/// Trimmed value of an attribute, matched by local name ignoring case
/// (`attribute(e, "lang")` finds `xml:lang`).
pub(super) fn attribute(element: &BytesStart<'_>, key: &str) -> Option<String> {
    element
        .attributes()
        .with_checks(false)
        .flatten()
        .find(|attr| attr.key.local_name().as_ref().eq_ignore_ascii_case(key.as_bytes()))
        .and_then(|attr| attr.unescape_value().ok().map(|value| value.trim().to_owned()))
}

/// Leading integer of an attribute such as `n="3"` or `vnumber="1-2"`.
pub(super) fn number(element: &BytesStart<'_>, key: &str) -> Option<i32> {
    leading_number(&attribute(element, key)?)
}

pub(super) fn leading_number(value: &str) -> Option<i32> {
    let digits: String = value
        .trim()
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    digits.parse().ok()
}

/// Character data carried by a text, CDATA or entity-reference event.
pub(super) fn text<'a>(event: &Event<'a>) -> Option<Cow<'a, str>> {
    match event {
        Event::Text(text) => text.decode().ok(),
        Event::CData(data) => data.decode().ok(),
        Event::GeneralRef(reference) => {
            if let Ok(Some(ch)) = reference.resolve_char_ref() {
                return Some(Cow::Owned(ch.to_string()));
            }
            let entity = reference.decode().ok()?;
            match quick_xml::escape::resolve_predefined_entity(&entity) {
                Some(value) => Some(Cow::Borrowed(value)),
                // `&nbsp;` and friends: keep a word break rather than the raw name.
                None => Some(Cow::Borrowed(" ")),
            }
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn root_skips_declaration_and_comments() {
        let xml = "<?xml version=\"1.0\"?><!-- hi --><osis:osis xmlns:osis=\"x\"/>";
        assert_eq!(root_element(xml).unwrap(), "osis");
    }

    #[test]
    fn numbers_take_the_leading_digits() {
        assert_eq!(leading_number("12"), Some(12));
        assert_eq!(leading_number(" 3-4"), Some(3));
        assert_eq!(leading_number("x"), None);
    }
}
