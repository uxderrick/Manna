//! OpenLP custom slides and service files.
//!
//! - Custom slides live in `Data/custom/custom.sqlite`, table `custom_slide`
//!   (`title`, `text`); `text` uses the same `<verse>` XML as song lyrics, one
//!   verse per slide.
//! - A service file (`.osz`, or `.oszl` without media) is a zip holding a JSON
//!   `*.osj`: an array whose first entry is `{"openlp_core": …}` and the rest
//!   `{"serviceitem": {"header": {"name": plugin, "title": …}, "data": [slides]}}`.
//!   Text plugins (`songs`, `bibles`, `custom`) carry each slide as
//!   `{"raw_slide": text, "verseTag": "V1"}`; media plugins carry file names.

use std::path::Path;

use rusqlite::{Connection, OpenFlags};
use serde_json::Value;

use super::archive::Archive;
use super::openlp::{parse_lyrics, strip_markup};
use super::text::clean_lines;
use super::{
    ImportedDeck, ImportedService, ImportedSong, ParsedSource, Section, SectionKind, ServiceItem, SOURCE_OPENLP,
};

pub const SERVICE_EXTENSIONS: &[&str] = &["osz", "oszl"];

/// Where OpenLP keeps custom slides below its data folder.
pub fn custom_db_candidates(openlp_root: &Path) -> Vec<std::path::PathBuf> {
    ["Data/custom/custom.sqlite", "data/custom/custom.sqlite", "custom/custom.sqlite"]
        .iter()
        .map(|rel| openlp_root.join(rel))
        .collect()
}

/// Read every custom slide deck from `custom.sqlite`.
pub fn read_custom_db(path: &Path) -> Result<ParsedSource, String> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .map_err(|e| format!("Could not open {}: {e}", path.display()))?;
    let sql_err = |e: rusqlite::Error| format!("Not an OpenLP custom slides database ({e})");
    let mut stmt = conn.prepare("SELECT title, text FROM custom_slide ORDER BY title").map_err(sql_err)?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?)))
        .map_err(sql_err)?;
    let mut parsed = ParsedSource::default();
    for row in rows {
        let (title, text) = row.map_err(sql_err)?;
        let title = title.unwrap_or_default().trim().to_string();
        let slides: Vec<String> = parse_lyrics(text.as_deref().unwrap_or(""), "")
            .into_iter()
            .map(|s| s.lines.join("\n"))
            .collect();
        if slides.is_empty() {
            parsed.report.fail(title, "no slide text");
            continue;
        }
        parsed.decks.push((SOURCE_OPENLP, ImportedDeck { title, slides }));
    }
    Ok(parsed)
}

fn str_field<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}

fn slide_text(slide: &Value) -> String {
    let raw = slide.get("raw_slide").or_else(|| slide.get("text")).and_then(Value::as_str).unwrap_or("");
    clean_lines(strip_markup(raw).lines()).join("\n")
}

/// A song carried in a service: slides grouped by verse tag (`V1`, `C1`…),
/// consecutive slides with one tag joined, later repeats dropped.
fn service_song(header: &Value, slides: &[Value]) -> Option<ImportedSong> {
    let title = str_field(header, "title").trim().to_string();
    let mut sections: Vec<(String, Section)> = Vec::new();
    for slide in slides {
        let tag = str_field(slide, "verseTag").to_lowercase();
        let lines: Vec<String> = slide_text(slide).lines().map(str::to_string).collect();
        if lines.is_empty() {
            continue;
        }
        if let Some((last, section)) = sections.last_mut() {
            if *last == tag && !tag.is_empty() {
                section.lines.extend(lines);
                continue;
            }
        }
        if !tag.is_empty() && sections.iter().any(|(t, _)| *t == tag) {
            continue; // a repeat of a section already captured
        }
        let kind = match tag.chars().next() {
            Some('c') => SectionKind::Chorus,
            Some('v') | None => SectionKind::Verse,
            _ => SectionKind::Other,
        };
        sections.push((tag, Section { kind, lines }));
    }
    if title.is_empty() || sections.is_empty() {
        return None;
    }
    let author = header
        .get("audit")
        .and_then(|a| a.get(1))
        .and_then(Value::as_array)
        .map(|names| names.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(", "))
        .filter(|a| !a.is_empty());
    Some(ImportedSong {
        id: format!("openlp-service-{}", super::text::slug(&title)),
        source: SOURCE_OPENLP,
        title,
        author,
        sections: sections.into_iter().map(|(_, s)| s).collect(),
    })
}

/// Map OpenLP service JSON to an [`ImportedService`].
pub fn parse_service_json(json: &str, name: &str) -> Result<ImportedService, String> {
    let root: Value = serde_json::from_str(json).map_err(|e| format!("Service file is not valid JSON ({e})"))?;
    let entries = root.as_array().ok_or("Service file has no item list")?;
    let mut items = Vec::new();
    for entry in entries {
        let Some(item) = entry.get("serviceitem") else { continue };
        let header = item.get("header").cloned().unwrap_or(Value::Null);
        let slides = item.get("data").and_then(Value::as_array).cloned().unwrap_or_default();
        let plugin = str_field(&header, "name");
        let title = str_field(&header, "title").trim().to_string();
        let item = match plugin {
            "songs" => match service_song(&header, &slides) {
                Some(song) => ServiceItem::Song(song),
                None => ServiceItem::SongTitle(title),
            },
            "bibles" | "custom" => {
                let texts: Vec<String> = slides.iter().map(slide_text).filter(|t| !t.is_empty()).collect();
                if texts.is_empty() {
                    continue;
                }
                ServiceItem::Slides(ImportedDeck { title, slides: texts })
            }
            "images" => ServiceItem::Unsupported { kind: "Image".into(), title },
            "media" => ServiceItem::Unsupported { kind: "Media".into(), title },
            "presentations" => ServiceItem::Unsupported { kind: "Presentation".into(), title },
            other => ServiceItem::Unsupported { kind: other.to_string(), title },
        };
        items.push(item);
    }
    Ok(ImportedService { name: name.to_string(), source: SOURCE_OPENLP, items })
}

/// Read an OpenLP service file (`.osz` / `.oszl`).
pub fn read_service(path: &Path) -> Result<ParsedSource, String> {
    let mut zip = Archive::open(path)?;
    let entry = zip
        .find(|n| n.to_lowercase().ends_with(".osj"))
        .ok_or("No service data (.osj) inside this file. Services saved by OpenLP 2.4 or newer are supported.")?;
    let json = String::from_utf8_lossy(&zip.read(&entry)?).into_owned();
    let name = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let service = parse_service_json(&json, &name)?;
    let mut parsed = ParsedSource::default();
    parsed.report.found = service.items.iter().filter(|i| matches!(i, ServiceItem::Song(_))).count();
    parsed.services.push(service);
    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SERVICE: &str = r#"[
      {"openlp_core": {"lite-service": false, "service-theme": ""}},
      {"serviceitem": {"header": {"name": "songs", "title": "Way Maker", "audit": ["Way Maker", ["Sinach"], "7115744", ""]},
        "data": [
          {"raw_slide": "You are here\nmoving in our midst", "verseTag": "V1"},
          {"raw_slide": "{st}Way maker{/st}, miracle worker", "verseTag": "C1"},
          {"raw_slide": "You are here\nworking in this place", "verseTag": "V2"},
          {"raw_slide": "{st}Way maker{/st}, miracle worker", "verseTag": "C1"}
        ]}},
      {"serviceitem": {"header": {"name": "bibles", "title": "John 3:16 KJV"},
        "data": [{"raw_slide": "16 For God so loved the world", "verseTag": "1"}]}},
      {"serviceitem": {"header": {"name": "images", "title": "Welcome.png"}, "data": [{"title": "Welcome.png"}]}}
    ]"#;

    #[test]
    fn service_items_map_to_songs_slides_and_placeholders() {
        let s = parse_service_json(SERVICE, "Sunday").unwrap();
        assert_eq!(s.items.len(), 3);
        let ServiceItem::Song(song) = &s.items[0] else { panic!("song expected") };
        assert_eq!(song.author.as_deref(), Some("Sinach"));
        assert_eq!(song.sections.len(), 3, "repeat chorus dropped");
        assert_eq!(song.sections[1].kind, SectionKind::Chorus);
        assert_eq!(song.sections[1].lines, ["Way maker, miracle worker"]);
        assert!(matches!(&s.items[1], ServiceItem::Slides(d) if d.title == "John 3:16 KJV"));
        assert!(matches!(&s.items[2], ServiceItem::Unsupported { kind, .. } if kind == "Image"));
    }

    #[test]
    fn reads_osz_zip() {
        let dir = std::env::temp_dir().join(format!("manna-osz-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("Sunday Morning.osz");
        super::super::archive::write_zip(&path, &[("Sunday Morning.osj", SERVICE.as_bytes())]);
        let parsed = read_service(&path).unwrap();
        assert_eq!(parsed.services[0].name, "Sunday Morning");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn custom_slides_become_decks() {
        let dir = std::env::temp_dir().join(format!("manna-custom-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("custom.sqlite");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            r#"CREATE TABLE custom_slide (id INTEGER PRIMARY KEY, title TEXT, text TEXT, credits TEXT, theme_name TEXT);
               INSERT INTO custom_slide (title, text) VALUES ('Welcome',
               '<?xml version="1.0" encoding="UTF-8"?><song version="1.0"><lyrics><verse label="1" type="custom"><![CDATA[Welcome to church]]></verse><verse label="2" type="custom"><![CDATA[Please silence phones]]></verse></lyrics></song>');"#,
        )
        .unwrap();
        drop(conn);
        let parsed = read_custom_db(&path).unwrap();
        assert_eq!(parsed.decks.len(), 1);
        assert_eq!(parsed.decks[0].1.slides, ["Welcome to church", "Please silence phones"]);
        std::fs::remove_dir_all(dir).ok();
    }
}
