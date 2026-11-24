//! ProPresenter importer.
//!
//! - ProPresenter 4/5/6 documents (`.pro4`/`.pro5`/`.pro6`) are XML. Slide text
//!   is base64-encoded RTF: an `RTFData` attribute on `RVTextElement` (v4/v5)
//!   or an `<NSString rvXMLIvarName="RTFData">` child (v6). v5/v6 group slides
//!   into `RVSlideGrouping`s named "Verse 1", "Chorus"... (same reading as
//!   OpenLP's importer).
//! - ProPresenter 7 documents (`.pro`) are protobuf `rv.data.Presentation`:
//!   `cue_groups` (12) name the sections and list cue ids; each cue (13) holds
//!   slide actions whose text elements carry RTF in `Graphics.Text.rtf_data`.
//! - Exported playlists: `.pro6plx` (zip with a `.pro6pl` XML playlist plus the
//!   documents) and `.proPlaylist` (zip with a protobuf `data` file plus the
//!   documents) become services.

use std::path::{Path, PathBuf};

use base64::Engine as _;
use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;

use super::archive::{base_name, stem, Archive};
use super::protobuf::{uuid, Message};
use super::rtf::rtf_to_text;
use super::text::{clean_lines, decode_text, section_label, slug};
use super::{ImportedService, ImportedSong, ParsedSource, Section, SectionKind, ServiceItem, SOURCE_PROPRESENTER};

pub const DOCUMENT_EXTENSIONS: &[&str] = &["pro", "pro6", "pro5", "pro4"];
pub const PLAYLIST_EXTENSIONS: &[&str] = &["pro6plx", "proplaylist"];

fn ext_of(path: &Path) -> String {
    path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase()
}

pub fn is_document(path: &Path) -> bool {
    DOCUMENT_EXTENSIONS.contains(&ext_of(path).as_str())
}

/// Parse one document, choosing the format from its first bytes.
pub fn parse_document(bytes: &[u8], fallback_title: &str) -> Option<ImportedSong> {
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(256)]);
    if head.trim_start_matches('\u{feff}').trim_start().starts_with('<') {
        parse_xml(&decode_text(bytes), fallback_title)
    } else {
        parse_pro7(bytes, fallback_title)
    }
}

/// Read ProPresenter documents (files, or folders searched two levels deep).
pub fn read_documents(paths: &[PathBuf]) -> ParsedSource {
    let mut files = Vec::new();
    for path in paths {
        collect_documents(path, 2, &mut files);
    }
    files.sort();
    let mut parsed = ParsedSource::default();
    for file in files {
        parsed.report.found += 1;
        let name = file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        match std::fs::read(&file) {
            Ok(bytes) => match parse_document(&bytes, stem(&name)) {
                Some(song) => parsed.songs.push(song),
                None => parsed.report.fail(name, "no slide text found"),
            },
            Err(e) => parsed.report.fail(name, e.to_string()),
        }
    }
    parsed
}

fn collect_documents(path: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if path.is_file() {
        if is_document(path) {
            out.push(path.to_path_buf());
        }
        return;
    }
    if depth == 0 {
        return;
    }
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            collect_documents(&entry.path(), depth - 1, out);
        }
    }
}

fn song_id(ccli_number: Option<&str>, title: &str) -> String {
    match ccli_number.map(str::trim).filter(|n| !n.is_empty() && *n != "0") {
        Some(n) => format!("propresenter-ccli-{n}"),
        None => format!("propresenter-{}", slug(title)),
    }
}

/// Turn named groups of slide texts into song sections.
fn sections_from_groups(groups: Vec<(String, Vec<String>)>) -> Vec<Section> {
    groups
        .into_iter()
        .filter_map(|(name, slides)| {
            let lines = clean_lines(slides.iter().flat_map(|s| s.lines()));
            if lines.is_empty() {
                return None;
            }
            let kind = section_label(&name).unwrap_or(SectionKind::Verse);
            Some(Section { kind, lines })
        })
        .collect()
}

fn song(title: String, author: Option<String>, ccli: Option<&str>, groups: Vec<(String, Vec<String>)>) -> Option<ImportedSong> {
    let sections = sections_from_groups(groups);
    if sections.is_empty() {
        return None;
    }
    Some(ImportedSong {
        id: song_id(ccli, &title),
        source: SOURCE_PROPRESENTER,
        title,
        author: author.filter(|a| !a.trim().is_empty()),
        sections,
    })
}

// ------------------------------------------------------------ v4 / v5 / v6

fn attr(e: &BytesStart<'_>, name: &str) -> Option<String> {
    e.attributes().flatten().find(|a| a.key.as_ref() == name.as_bytes()).map(|a| {
        let raw = String::from_utf8_lossy(&a.value).into_owned();
        quick_xml::escape::unescape(&raw).map(std::borrow::Cow::into_owned).unwrap_or(raw)
    })
}

fn rtf_from_base64(b64: &str) -> Option<String> {
    let cleaned: String = b64.chars().filter(|c| !c.is_whitespace()).collect();
    let bytes = base64::engine::general_purpose::STANDARD.decode(cleaned).ok()?;
    let text = rtf_to_text(&decode_text(&bytes));
    Some(text)
}

#[derive(Default)]
struct XmlSong {
    title: Option<String>,
    author: Option<String>,
    ccli: Option<String>,
    groups: Vec<(String, Vec<String>)>,
}

impl XmlSong {
    fn slide_text(&mut self, text: String) {
        if self.groups.is_empty() {
            self.groups.push((String::new(), Vec::new()));
        }
        if let Some((_, slides)) = self.groups.last_mut() {
            match slides.last_mut() {
                Some(s) if !s.is_empty() => {
                    s.push('\n');
                    s.push_str(&text);
                }
                Some(s) => *s = text,
                None => slides.push(text),
            }
        }
    }
}

/// ProPresenter 4, 5 and 6 (XML).
pub fn parse_xml(xml: &str, fallback_title: &str) -> Option<ImportedSong> {
    let mut reader = Reader::from_str(xml);
    let mut doc = XmlSong::default();
    let mut grouped = false;
    // Set while inside <NSString rvXMLIvarName="RTFData"> of a text element.
    let mut in_rtf_string = false;
    let mut text_depth = 0usize;

    loop {
        let event = match reader.read_event() {
            Ok(Event::Eof) | Err(_) => break,
            Ok(e) => e,
        };
        match event {
            Event::Start(ref e) | Event::Empty(ref e) => {
                let is_empty = matches!(event, Event::Empty(_));
                match e.name().as_ref() {
                    b"RVPresentationDocument" => {
                        doc.title = attr(e, "CCLISongTitle").filter(|t| !t.trim().is_empty());
                        doc.author = ["CCLIAuthor", "author", "artist", "CCLIArtistCredits"]
                            .iter()
                            .find_map(|k| attr(e, k).filter(|v| !v.trim().is_empty()));
                        doc.ccli = attr(e, "CCLISongNumber").or_else(|| attr(e, "CCLILicenseNumber"));
                    }
                    b"RVSlideGrouping" => {
                        grouped = true;
                        doc.groups.push((attr(e, "name").unwrap_or_default(), Vec::new()));
                    }
                    b"RVDisplaySlide" => {
                        if !grouped {
                            // v4: no groups, one section per slide.
                            doc.groups.push((String::new(), Vec::new()));
                        }
                        if let Some((_, slides)) = doc.groups.last_mut() {
                            slides.push(String::new());
                        }
                    }
                    b"RVTextElement" => {
                        if let Some(text) = attr(e, "RTFData").and_then(|b| rtf_from_base64(&b)) {
                            doc.slide_text(text);
                        }
                        if !is_empty {
                            text_depth += 1;
                        }
                    }
                    b"NSString" if text_depth > 0 && !is_empty => {
                        in_rtf_string = attr(e, "rvXMLIvarName").as_deref() == Some("RTFData");
                    }
                    _ => {}
                }
            }
            Event::Text(t) if in_rtf_string => {
                let raw = String::from_utf8_lossy(&t).into_owned();
                if let Some(text) = rtf_from_base64(&raw) {
                    doc.slide_text(text);
                }
                in_rtf_string = false;
            }
            Event::End(ref e) => match e.name().as_ref() {
                b"RVTextElement" => text_depth = text_depth.saturating_sub(1),
                b"NSString" => in_rtf_string = false,
                _ => {}
            },
            _ => {}
        }
    }

    let title = doc.title.unwrap_or_else(|| fallback_title.to_string());
    song(title, doc.author, doc.ccli.as_deref(), doc.groups)
}

// ------------------------------------------------------------------- v7

/// Text of one cue: every text element of every slide action.
fn cue_text(cue: Message<'_>) -> String {
    let mut parts = Vec::new();
    for action in cue.messages(10) {
        // Action.slide (23) -> SlideType.presentation (2) -> PresentationSlide.base_slide (1)
        let Some(slide) = action.path(&[23, 2, 1]) else { continue };
        for element in slide.messages(1) {
            // Slide.Element.element (1) -> Graphics.Element.text (13) -> Text.rtf_data (5)
            if let Some(rtf) = element.path(&[1, 13]).and_then(|t| t.bytes(5)) {
                let text = rtf_to_text(&String::from_utf8_lossy(rtf));
                if !text.trim().is_empty() {
                    parts.push(text);
                }
            }
        }
    }
    parts.join("\n")
}

/// ProPresenter 7 (`rv.data.Presentation` protobuf).
pub fn parse_pro7(bytes: &[u8], fallback_title: &str) -> Option<ImportedSong> {
    let doc = Message(bytes);
    let ccli = doc.message(14);
    let title = ccli
        .and_then(|c| c.string(3))
        .or_else(|| doc.string(3))
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| fallback_title.to_string());
    let author = ccli.and_then(|c| c.string(1).or_else(|| c.string(2)));
    let ccli_number = ccli.and_then(|c| c.varint(6)).filter(|n| *n > 0).map(|n| n.to_string());

    let cues: Vec<(Option<String>, String)> = doc
        .messages(13)
        .into_iter()
        .map(|cue| (cue.message(1).and_then(uuid), cue_text(cue)))
        .collect();
    let text_of = |id: &str| cues.iter().find(|(u, _)| u.as_deref() == Some(id)).map(|(_, t)| t.clone());

    let mut groups: Vec<(String, Vec<String>)> = Vec::new();
    for cue_group in doc.messages(12) {
        let name = cue_group.message(1).and_then(|g| g.string(2)).unwrap_or_default();
        let slides = cue_group.messages(2).into_iter().filter_map(uuid).filter_map(|id| text_of(&id)).collect();
        groups.push((name, slides));
    }
    if groups.iter().all(|(_, s)| s.is_empty()) {
        groups = cues.into_iter().map(|(_, t)| (String::new(), vec![t])).collect();
    }
    song(title, author, ccli_number.as_deref(), groups)
}

// -------------------------------------------------------------- playlists

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The document a playlist cue points at, if it was bundled in the export.
fn bundled_song(zip: &mut Archive, doc_path: &str, title: &str) -> Option<ImportedSong> {
    let wanted = base_name(&percent_decode(doc_path)).to_lowercase();
    if wanted.is_empty() {
        return None;
    }
    let entry = zip.find(|n| n.to_lowercase() == wanted)?;
    let bytes = zip.read(&entry).ok()?;
    parse_document(&bytes, title)
}

fn playlist_song_item(zip: &mut Archive, doc_path: &str, title: &str) -> ServiceItem {
    let title = if title.trim().is_empty() { stem(&percent_decode(doc_path)).to_string() } else { title.to_string() };
    match bundled_song(zip, doc_path, &title) {
        Some(song) => ServiceItem::Song(song),
        None => ServiceItem::SongTitle(title),
    }
}

/// `.pro6plx`: zip with a `*.pro6pl` XML playlist and the documents.
fn read_pro6_playlist(zip: &mut Archive) -> Result<Vec<ServiceItem>, String> {
    let entry = zip
        .find(|n| n.to_lowercase().ends_with(".pro6pl"))
        .ok_or("No .pro6pl playlist inside the bundle")?;
    let xml = decode_text(&zip.read(&entry)?);
    let mut reader = Reader::from_str(&xml);
    let mut cues: Vec<(String, String, String)> = Vec::new(); // (element, displayName, filePath)
    loop {
        match reader.read_event() {
            Ok(Event::Eof) | Err(_) => break,
            Ok(Event::Start(e) | Event::Empty(e)) => {
                let tag = String::from_utf8_lossy(e.name().as_ref()).into_owned();
                if tag.ends_with("Cue") {
                    let display = attr(&e, "displayName").unwrap_or_default();
                    let path = attr(&e, "filePath").unwrap_or_default();
                    cues.push((tag, display, path));
                }
            }
            Ok(_) => {}
        }
    }
    Ok(cues
        .into_iter()
        .map(|(tag, display, path)| match tag.as_str() {
            "RVDocumentCue" => playlist_song_item(zip, &path, &display),
            t if t.contains("Header") => ServiceItem::Header(display),
            t => ServiceItem::Unsupported {
                kind: t.trim_start_matches("RV").trim_end_matches("Cue").to_string(),
                title: if display.is_empty() { stem(&percent_decode(&path)).to_string() } else { display },
            },
        })
        .collect())
}

/// Playlists inside `rv.data.Playlist`, depth first, with their items.
fn collect_pro7_playlists<'a>(node: Message<'a>, out: &mut Vec<(String, Vec<Message<'a>>)>) {
    // PlaylistItems (13) -> items (1)
    let items: Vec<Message<'a>> = node.message(13).map(|p| p.messages(1)).unwrap_or_default();
    if !items.is_empty() {
        out.push((node.string(2).unwrap_or_default(), items));
    }
    // PlaylistArray (12) -> playlists (1)
    if let Some(children) = node.message(12) {
        for child in children.messages(1) {
            collect_pro7_playlists(child, out);
        }
    }
}

/// `.proPlaylist`: zip with a protobuf `data` file (`rv.data.PlaylistDocument`).
fn read_pro7_playlist(zip: &mut Archive, name: &str) -> Result<Vec<(String, Vec<ServiceItem>)>, String> {
    let entry = zip.find(|n| n == "data").ok_or("No playlist data inside the bundle")?;
    let bytes = zip.read(&entry)?;
    let doc = Message(&bytes);
    let root = doc.message(3).ok_or("Playlist data is empty")?;
    let mut playlists = Vec::new();
    collect_pro7_playlists(root, &mut playlists);
    let mut out = Vec::new();
    for (playlist_name, items) in playlists {
        let mut service = Vec::new();
        for item in items {
            let title = item.string(2).unwrap_or_default();
            if item.message(3).is_some() {
                service.push(ServiceItem::Header(title));
            } else if let Some(pres) = item.message(4) {
                // Presentation.document_path (1) -> URL.absolute_string (1) | relative_path (2)
                let url = pres.message(1);
                let path = url.and_then(|u| u.string(1).or_else(|| u.string(2))).unwrap_or_default();
                service.push(playlist_song_item(zip, &path, &title));
            } else {
                service.push(ServiceItem::Unsupported { kind: "Cue".into(), title });
            }
        }
        let playlist_name = if playlist_name.trim().is_empty() { name.to_string() } else { playlist_name };
        out.push((playlist_name, service));
    }
    Ok(out)
}

/// Read an exported playlist bundle into services.
pub fn read_playlist(path: &Path) -> Result<ParsedSource, String> {
    let mut zip = Archive::open(path)?;
    let name = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let playlists = match ext_of(path).as_str() {
        "pro6plx" => vec![(name.clone(), read_pro6_playlist(&mut zip)?)],
        _ => read_pro7_playlist(&mut zip, &name)?,
    };
    let mut parsed = ParsedSource::default();
    for (playlist_name, items) in playlists {
        parsed.services.push(ImportedService { name: playlist_name, source: SOURCE_PROPRESENTER, items });
    }
    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::super::protobuf::encode::{int, msg, string};
    use super::*;

    fn b64_rtf(text: &str) -> String {
        let rtf = format!(r"{{\rtf1\ansi{{\fonttbl\f0 Arial;}}\f0 {}}}", text.replace('\n', r"\par "));
        base64::engine::general_purpose::STANDARD.encode(rtf)
    }

    #[test]
    fn pro6_groups_become_sections() {
        let xml = format!(
            r#"<?xml version="1.0"?>
<RVPresentationDocument versionNumber="600" CCLISongTitle="Way Maker" CCLIAuthor="Sinach" CCLISongNumber="7115744">
 <array rvXMLIvarName="groups">
  <RVSlideGrouping name="Verse 1"><array rvXMLIvarName="slides">
   <RVDisplaySlide><array rvXMLIvarName="displayElements"><RVTextElement>
     <NSString rvXMLIvarName="PlainText">aWdub3JlZA==</NSString>
     <NSString rvXMLIvarName="RTFData">{v}</NSString>
   </RVTextElement></array></RVDisplaySlide>
  </array></RVSlideGrouping>
  <RVSlideGrouping name="Chorus"><array rvXMLIvarName="slides">
   <RVDisplaySlide><array rvXMLIvarName="displayElements"><RVTextElement>
     <NSString rvXMLIvarName="RTFData">{c}</NSString>
   </RVTextElement></array></RVDisplaySlide>
  </array></RVSlideGrouping>
 </array>
</RVPresentationDocument>"#,
            v = b64_rtf("You are here\nMoving in our midst"),
            c = b64_rtf("Way maker, miracle worker")
        );
        let song = parse_document(xml.as_bytes(), "file").unwrap();
        assert_eq!(song.title, "Way Maker");
        assert_eq!(song.id, "propresenter-ccli-7115744");
        assert_eq!(song.author.as_deref(), Some("Sinach"));
        assert_eq!(song.sections.len(), 2);
        assert_eq!(song.sections[0].lines, ["You are here", "Moving in our midst"]);
        assert_eq!(song.sections[1].kind, SectionKind::Chorus);
    }

    #[test]
    fn pro4_attribute_rtf_without_groups() {
        let xml = format!(
            r#"<RVPresentationDocument versionNumber="400"><slides>
               <RVDisplaySlide><displayElements><RVTextElement RTFData="{a}"/></displayElements></RVDisplaySlide>
               <RVDisplaySlide><displayElements><RVTextElement RTFData="{b}"/></displayElements></RVDisplaySlide>
               </slides></RVPresentationDocument>"#,
            a = b64_rtf("First"),
            b = b64_rtf("Second")
        );
        let song = parse_document(xml.as_bytes(), "Old Song").unwrap();
        assert_eq!(song.title, "Old Song");
        assert_eq!(song.id, "propresenter-old-song");
        assert_eq!(song.sections.len(), 2);
    }

    fn pro7_cue(id: &str, text: &str) -> Vec<u8> {
        let rtf = format!(r"{{\rtf1\ansi\cocoartf2639 {}}}", text.replace('\n', r"\par "));
        let element = msg(1, &[msg(1, &[string(2, "Text"), msg(13, &[super::super::protobuf::encode::bytes(5, rtf.as_bytes())])])]);
        let slide = msg(1, &[element]);
        let action = msg(10, &[msg(23, &[msg(2, &[slide])])]);
        msg(13, &[msg(1, &[string(1, id)]), action])
    }

    fn pro7_doc() -> Vec<u8> {
        [
            string(3, "Goodness of God"),
            msg(14, &[string(1, "Jenn Johnson"), string(3, "Goodness Of God"), int(6, 7_117_726)]),
            msg(12, &[msg(1, &[string(2, "Verse 1")]), msg(2, &[string(1, "a")])]),
            msg(12, &[msg(1, &[string(2, "Chorus")]), msg(2, &[string(1, "b")]), msg(2, &[string(1, "c")])]),
            pro7_cue("A", "I love You Lord"),
            pro7_cue("B", "All my life"),
            pro7_cue("C", "You have been so good"),
        ]
        .concat()
    }

    #[test]
    fn pro7_cue_groups_become_sections() {
        let song = parse_document(&pro7_doc(), "file").unwrap();
        assert_eq!(song.title, "Goodness Of God");
        assert_eq!(song.id, "propresenter-ccli-7117726");
        assert_eq!(song.author.as_deref(), Some("Jenn Johnson"));
        assert_eq!(song.sections[0].lines, ["I love You Lord"]);
        assert_eq!(song.sections[1].kind, SectionKind::Chorus);
        assert_eq!(song.sections[1].lines, ["All my life", "You have been so good"]);
    }

    #[test]
    fn pro7_playlist_bundle_links_documents() {
        let dir = std::env::temp_dir().join(format!("manna-pp-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("Sunday.proPlaylist");
        let item_header = msg(1, &[string(2, "Worship"), msg(3, &[])]);
        let item_song = msg(
            1,
            &[string(2, "Goodness of God"), msg(4, &[msg(1, &[string(1, "file:///Users/x/Goodness%20of%20God.pro")])])],
        );
        let item_missing = msg(1, &[string(2, "Not Bundled"), msg(4, &[msg(1, &[string(1, "Not%20Bundled.pro")])])]);
        let playlist = msg(3, &[string(2, "Sunday Service"), msg(13, &[item_header, item_song, item_missing])]);
        super::super::archive::write_zip(&path, &[("data", &playlist), ("Goodness of God.pro", &pro7_doc())]);

        let parsed = read_playlist(&path).unwrap();
        assert_eq!(parsed.services.len(), 1);
        let s = &parsed.services[0];
        assert_eq!(s.name, "Sunday Service");
        assert_eq!(s.items[0], ServiceItem::Header("Worship".into()));
        assert!(matches!(&s.items[1], ServiceItem::Song(song) if song.title == "Goodness Of God"));
        assert_eq!(s.items[2], ServiceItem::SongTitle("Not Bundled".into()));
        std::fs::remove_dir_all(dir).ok();
    }
}
