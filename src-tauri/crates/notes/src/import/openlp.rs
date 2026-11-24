//! OpenLP importer.
//!
//! OpenLP's `songs.sqlite` is plain SQLite. Lyrics are a small XML document:
//! `<song version="1.0"><lyrics><verse type="v" label="1"><![CDATA[…]]></verse>…`
//! with verse types `v` (verse), `c` (chorus), `b` (bridge), `p` (pre-chorus),
//! `i`/`e`/`o` (intro/ending/other). `verse_order` (e.g. `v1 c1 v2 c1`) gives
//! the sung order.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};

use super::text::clean_lines;
use super::{ImportedSong, ParsedSource, Section, SectionKind, SOURCE_OPENLP};

/// Where OpenLP keeps its song database below the platform data dir
/// (`~/Library/Application Support`, `%APPDATA%`, `~/.local/share`).
pub fn candidate_paths(data_dir: &Path) -> Vec<PathBuf> {
    ["Data/songs/songs.sqlite", "data/songs/songs.sqlite", "songs/songs.sqlite"]
        .iter()
        .map(|rel| data_dir.join("openlp").join(rel))
        .collect()
}

pub fn read_db(path: &Path) -> Result<ParsedSource, String> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .map_err(|e| format!("Could not open {}: {e}", path.display()))?;
    let sql_err = |e: rusqlite::Error| format!("Not an OpenLP song database ({e})");

    let has_temporary = conn
        .prepare("SELECT name FROM pragma_table_info('songs')")
        .and_then(|mut s| s.query_map([], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>())
        .map_err(sql_err)?
        .iter()
        .any(|c| c == "temporary");

    let authors = read_authors(&conn).map_err(sql_err)?;

    let filter = if has_temporary { r#"WHERE COALESCE("temporary", 0) = 0"# } else { "" };
    let mut stmt = conn
        .prepare(&format!("SELECT id, title, lyrics, verse_order FROM songs {filter} ORDER BY id"))
        .map_err(sql_err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(sql_err)?;

    let mut parsed = ParsedSource::default();
    for row in rows {
        parsed.report.found += 1;
        let (id, title, lyrics, verse_order) = match row {
            Ok(r) => r,
            Err(e) => {
                parsed.report.fail(format!("song #{}", parsed.report.found), e.to_string());
                continue;
            }
        };
        let sections = parse_lyrics(lyrics.as_deref().unwrap_or(""), verse_order.as_deref().unwrap_or(""));
        parsed.songs.push(ImportedSong {
            id: format!("openlp-{id}"),
            source: SOURCE_OPENLP,
            title: title.unwrap_or_default().trim().to_string(),
            author: authors.get(&id).map(|names| names.join(", ")),
            sections,
        });
    }
    Ok(parsed)
}

fn read_authors(conn: &Connection) -> rusqlite::Result<HashMap<i64, Vec<String>>> {
    let mut stmt = conn.prepare(
        "SELECT x.song_id, a.display_name FROM authors_songs x
         JOIN authors a ON a.id = x.author_id ORDER BY x.song_id",
    )?;
    let mut map: HashMap<i64, Vec<String>> = HashMap::new();
    for row in stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Option<String>>(1)?)))? {
        let (song_id, name) = row?;
        let Some(name) = name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty()) else { continue };
        let names = map.entry(song_id).or_default();
        if !names.contains(&name) {
            names.push(name);
        }
    }
    Ok(map)
}

/// Parse OpenLP lyrics XML into sections, ordered by `verse_order` when given.
pub fn parse_lyrics(xml: &str, verse_order: &str) -> Vec<Section> {
    let mut tagged: Vec<(String, Section)> = Vec::new();
    let mut rest = xml;
    while let Some(start) = find_verse_open(rest) {
        let after_open = &rest[start..];
        let Some(tag_end) = after_open.find('>') else { break };
        let open_tag = &after_open[..tag_end];
        let body_start = &after_open[tag_end + 1..];
        let Some(close) = body_start.find("</verse>") else { break };
        let body = &body_start[..close];
        rest = &body_start[close + "</verse>".len()..];

        let verse_type = attr(open_tag, "type").unwrap_or_else(|| "v".into()).to_lowercase();
        let label = attr(open_tag, "label").unwrap_or_else(|| "1".into());
        let kind = match verse_type.chars().next() {
            Some('v') => SectionKind::Verse,
            Some('c') => SectionKind::Chorus,
            _ => SectionKind::Other,
        };
        let text = strip_markup(&body_text(body));
        let lines = clean_lines(text.lines());
        if !lines.is_empty() {
            let key = format!("{}{}", verse_type.chars().next().unwrap_or('v'), label.to_lowercase());
            tagged.push((key, Section { kind, lines }));
        }
    }

    let order: Vec<String> = verse_order.split_whitespace().map(str::to_lowercase).collect();
    if !order.is_empty() {
        let rank = |key: &str| order.iter().position(|o| o == key).unwrap_or(usize::MAX);
        tagged.sort_by_key(|(key, _)| rank(key));
    }
    tagged.into_iter().map(|(_, s)| s).collect()
}

fn find_verse_open(s: &str) -> Option<usize> {
    let mut from = 0;
    while let Some(pos) = s[from..].find("<verse") {
        let at = from + pos;
        match s[at + "<verse".len()..].chars().next() {
            Some(c) if c.is_whitespace() || c == '>' => return Some(at),
            _ => from = at + 1,
        }
    }
    None
}

fn attr(tag: &str, name: &str) -> Option<String> {
    for quote in ['"', '\''] {
        let needle = format!("{name}={quote}");
        let mut from = 0;
        while let Some(pos) = tag[from..].find(&needle) {
            let at = from + pos;
            let boundary = tag[..at].chars().next_back().is_none_or(char::is_whitespace);
            let value_start = at + needle.len();
            if boundary {
                let end = tag[value_start..].find(quote)?;
                return Some(unescape(&tag[value_start..value_start + end]));
            }
            from = value_start;
        }
    }
    None
}

fn body_text(body: &str) -> String {
    let mut out = String::new();
    let mut rest = body;
    while let Some(start) = rest.find("<![CDATA[") {
        out.push_str(&unescape(&rest[..start]));
        let inner = &rest[start + "<![CDATA[".len()..];
        let end = inner.find("]]>").unwrap_or(inner.len());
        out.push_str(&inner[..end]);
        rest = inner.get(end + "]]>".len()..).unwrap_or("");
    }
    out.push_str(&unescape(rest));
    out
}

fn unescape(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = String::new();
    let mut rest = s;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        let tail = &rest[amp..];
        let Some(semi) = tail.find(';').filter(|&i| i <= 10) else {
            out.push('&');
            rest = &tail[1..];
            continue;
        };
        let entity = &tail[1..semi];
        let decoded = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            _ if entity.starts_with("#x") || entity.starts_with("#X") => {
                u32::from_str_radix(&entity[2..], 16).ok().and_then(char::from_u32)
            }
            _ if entity.starts_with('#') => entity[1..].parse().ok().and_then(char::from_u32),
            _ => None,
        };
        if let Some(c) = decoded {
            out.push(c);
            rest = &tail[semi + 1..];
        } else {
            out.push('&');
            rest = &tail[1..];
        }
    }
    out.push_str(rest);
    out
}

/// Remove OpenLP inline markup: chords and split markers in `[...]`
/// (`[G]`, `[---]`, `[--}{--]`) and formatting tags in `{...}` (`{st}`, `{/it}`).
pub(crate) fn strip_markup(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let close = match c {
            '[' => Some(']'),
            '{' => Some('}'),
            _ => None,
        };
        if let Some(close) = close {
            if let Some(len) = chars[i + 1..].iter().take(16).position(|&x| x == close || x == '\n') {
                if chars[i + 1 + len] == close {
                    i += len + 2;
                    continue;
                }
            }
        }
        out.push(c);
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const XML: &str = r#"<?xml version='1.0' encoding='UTF-8'?>
<song version="1.0"><lyrics><verse type="v" label="1"><![CDATA[All creatures of our [G]God and King,
{st}Lift up your voice{/st} & sing:]]></verse><verse type="c" label="1"><![CDATA[O praise Him,
[---]
Hallelujah!]]></verse><verse type="b" label="1">Bridge &amp; more</verse><verse type="v" label="2"><![CDATA[Thou rushing wind]]></verse></lyrics></song>"#;

    #[test]
    fn parses_cdata_entities_and_markup() {
        let s = parse_lyrics(XML, "");
        assert_eq!(s.len(), 4);
        assert_eq!(s[0].lines, vec!["All creatures of our God and King,", "Lift up your voice & sing:"]);
        assert_eq!(s[1].kind, SectionKind::Chorus);
        assert_eq!(s[1].lines, vec!["O praise Him,", "Hallelujah!"]);
        assert_eq!(s[2].kind, SectionKind::Other);
        assert_eq!(s[2].lines, vec!["Bridge & more"]);
    }

    #[test]
    fn verse_order_reorders_sections() {
        let s = parse_lyrics(XML, "v1 c1 v2 c1 b1");
        let firsts: Vec<_> = s.iter().map(|x| x.lines[0].as_str()).collect();
        assert_eq!(firsts, vec!["All creatures of our God and King,", "O praise Him,", "Thou rushing wind", "Bridge & more"]);
    }

    #[test]
    fn reads_openlp_db() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("songs.sqlite");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            r#"CREATE TABLE songs (id INTEGER PRIMARY KEY, title TEXT, lyrics TEXT, verse_order TEXT, "temporary" BOOLEAN);
               CREATE TABLE authors (id INTEGER PRIMARY KEY, display_name TEXT);
               CREATE TABLE authors_songs (author_id INTEGER, song_id INTEGER, author_type TEXT);
               INSERT INTO authors VALUES (1, 'John Newton'), (2, 'Edwin Excell');
               INSERT INTO authors_songs VALUES (1, 7, 'words'), (2, 7, 'music'), (1, 7, 'music');"#,
        )
        .unwrap();
        conn.execute("INSERT INTO songs VALUES (7, 'Amazing Grace', ?1, '', 0)", [XML]).unwrap();
        conn.execute("INSERT INTO songs VALUES (8, 'Scratch', ?1, '', 1)", [XML]).unwrap();
        drop(conn);

        let parsed = read_db(&path).unwrap();
        assert_eq!(parsed.report.found, 1, "temporary songs are skipped");
        let song = &parsed.songs[0];
        assert_eq!(song.id, "openlp-7");
        assert_eq!(song.author.as_deref(), Some("John Newton, Edwin Excell"));
        assert_eq!(song.sections.len(), 4);
    }

    #[test]
    fn rejects_non_openlp_db() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("other.sqlite");
        Connection::open(&path).unwrap().execute_batch("CREATE TABLE x (a);").unwrap();
        assert!(read_db(&path).is_err());
    }
}
