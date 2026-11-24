//! EasyWorship 6/7 importer.
//!
//! EasyWorship keeps songs in `…/<profile>/v6.1/Databases/Data/` as two plain
//! SQLite files: `Songs.db` (table `song`: title, author) and `SongWords.db`
//! (table `word`: `song_id`, RTF `words`). EasyWorship-native songs separate
//! slides with `\sdslidemarker` paragraphs; songs that came into EasyWorship
//! from other tools use blank lines instead.
//!
//! Schedules (`.ewsx`, EasyWorship 6/7) are zips holding a SQLite `main.db`:
//! `presentation` rows (one per schedule item; `presentation_type = 6` is a
//! song), their `slide`s, and `element`s whose `foreground_resource_id` points
//! at RTF in `resource_text` (same reading as OpenLP's importer).

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};

use super::archive::Archive;
use super::rtf::{rtf_to_text, SLIDE_MARKER};
use super::text::{clean_lines, section_label, slug};
use super::{
    ImportedDeck, ImportedService, ImportedSong, ParsedSource, Section, SectionKind, ServiceItem, SOURCE_EASYWORSHIP,
};

pub const SCHEDULE_EXTENSION: &str = "ewsx";
const SONG_PRESENTATION: i64 = 6;

/// `(rowid, title, author, presentation_type)` of one schedule item.
type ScheduleRow = (i64, Option<String>, Option<String>, Option<i64>);

const SONGS_DB: &str = "Songs.db";
const WORDS_DB: &str = "SongWords.db";

pub fn is_data_dir(dir: &Path) -> bool {
    dir.join(SONGS_DB).is_file() && dir.join(WORDS_DB).is_file()
}

/// Find EasyWorship data folders at or below `root` (bounded depth, so a
/// user can pick the profile folder, the EasyWorship folder, or the data
/// folder itself).
pub fn find_data_dirs(root: &Path, max_depth: usize) -> Vec<PathBuf> {
    let mut found = Vec::new();
    walk(root, max_depth, &mut found);
    found.sort();
    found
}

fn walk(dir: &Path, depth: usize, found: &mut Vec<PathBuf>) {
    if is_data_dir(dir) {
        found.push(dir.to_path_buf());
        return;
    }
    if depth == 0 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk(&path, depth - 1, found);
        }
    }
}

fn open_ro(path: &Path) -> Result<Connection, String> {
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .map_err(|e| format!("Could not open {}: {e}", path.display()))
}

/// Read every song from an EasyWorship data folder.
pub fn read_data_dir(dir: &Path) -> Result<ParsedSource, String> {
    if !is_data_dir(dir) {
        return Err(format!("{} has no {SONGS_DB} and {WORDS_DB}", dir.display()));
    }
    let songs_db = open_ro(&dir.join(SONGS_DB))?;
    let words_db = open_ro(&dir.join(WORDS_DB))?;
    let sql_err = |e: rusqlite::Error| format!("EasyWorship database not readable: {e}");

    let mut words: HashMap<i64, String> = HashMap::new();
    {
        let mut stmt = words_db.prepare("SELECT song_id, words FROM word").map_err(sql_err)?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Option<String>>(1)?)))
            .map_err(sql_err)?;
        for row in rows.flatten() {
            if let (id, Some(rtf)) = row {
                words.insert(id, rtf);
            }
        }
    }

    let mut parsed = ParsedSource::default();
    let mut stmt = songs_db
        .prepare("SELECT rowid, title, author FROM song ORDER BY rowid")
        .map_err(sql_err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(sql_err)?;

    for row in rows {
        parsed.report.found += 1;
        let (rowid, title, author) = match row {
            Ok(r) => r,
            Err(e) => {
                parsed.report.fail(format!("song #{}", parsed.report.found), e.to_string());
                continue;
            }
        };
        let sections = words.get(&rowid).map(|rtf| parse_words(rtf)).unwrap_or_default();
        parsed.songs.push(ImportedSong {
            // Same id scheme as data/import-easyworship.py, so earlier script
            // imports are recognised instead of duplicated.
            id: format!("ew-{rowid}"),
            source: SOURCE_EASYWORSHIP,
            title: title.unwrap_or_default().trim().to_string(),
            author: author.map(|a| a.trim().to_string()).filter(|a| !a.is_empty()),
            sections,
        });
    }
    Ok(parsed)
}

/// Read an EasyWorship 6/7 schedule (`.ewsx`) as a service.
pub fn read_schedule(path: &Path) -> Result<ParsedSource, String> {
    let mut zip = Archive::open(path)?;
    let entry = zip
        .find(|n| n.eq_ignore_ascii_case("main.db"))
        .ok_or("Not an EasyWorship schedule (no main.db inside)")?;
    let bytes = zip.read(&entry)?;
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.subsec_nanos());
    let tmp = std::env::temp_dir().join(format!("manna-ewsx-{}-{nanos}.db", std::process::id()));
    std::fs::write(&tmp, bytes).map_err(|e| format!("Could not unpack schedule: {e}"))?;
    let name = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let result = read_schedule_db(&tmp, &name);
    let _ = std::fs::remove_file(&tmp);
    result
}

fn read_schedule_db(db: &Path, name: &str) -> Result<ParsedSource, String> {
    let conn = open_ro(db)?;
    let sql_err = |e: rusqlite::Error| format!("EasyWorship schedule not readable: {e}");
    let has_order = conn
        .prepare("SELECT name FROM pragma_table_info('presentation')")
        .and_then(|mut s| s.query_map([], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>())
        .map_err(sql_err)?
        .iter()
        .any(|c| c == "order_index");
    let order = if has_order { "order_index, rowid" } else { "rowid" };
    let mut stmt = conn
        .prepare(&format!("SELECT rowid, title, author, presentation_type FROM presentation ORDER BY {order}"))
        .map_err(sql_err)?;
    let items: Vec<ScheduleRow> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .map_err(sql_err)?
        .collect::<Result<_, _>>()
        .map_err(sql_err)?;
    let mut texts = conn
        .prepare(
            "SELECT rt.rtf FROM element e
             JOIN slide s ON e.slide_id = s.rowid
             JOIN resource_text rt ON rt.resource_id = e.foreground_resource_id
             WHERE s.presentation_id = ?1 AND (?2 = 0 OR (e.element_type = 6 AND e.element_style_type = 4))
             ORDER BY s.order_index, e.rowid",
        )
        .map_err(sql_err)?;

    let mut parsed = ParsedSource::default();
    let mut service = ImportedService { name: name.to_string(), source: SOURCE_EASYWORSHIP, items: Vec::new() };
    for (rowid, title, author, kind) in items {
        let title = title.unwrap_or_default().trim().to_string();
        let is_song = kind == Some(SONG_PRESENTATION);
        let rtfs: Vec<String> = texts
            .query_map(rusqlite::params![rowid, i64::from(is_song)], |r| r.get::<_, Option<String>>(0))
            .map_err(sql_err)?
            .filter_map(|r| r.ok().flatten())
            .collect();
        if is_song {
            parsed.report.found += 1;
            let sections: Vec<Section> = rtfs.iter().flat_map(|rtf| parse_words(rtf)).collect();
            if sections.is_empty() {
                service.items.push(ServiceItem::SongTitle(title));
            } else {
                service.items.push(ServiceItem::Song(ImportedSong {
                    id: format!("ew-schedule-{}", slug(&title)),
                    source: SOURCE_EASYWORSHIP,
                    title,
                    author: author.map(|a| a.trim().to_string()).filter(|a| !a.is_empty()),
                    sections,
                }));
            }
            continue;
        }
        let slides: Vec<String> = rtfs
            .iter()
            .map(|rtf| clean_lines(rtf_to_text(rtf).replace(SLIDE_MARKER, "\n").lines()).join("\n"))
            .filter(|t| !t.is_empty())
            .collect();
        if slides.is_empty() {
            service.items.push(ServiceItem::Unsupported { kind: "EasyWorship item".into(), title });
        } else {
            service.items.push(ServiceItem::Slides(ImportedDeck { title, slides }));
        }
    }
    parsed.services.push(service);
    Ok(parsed)
}

/// Split RTF lyrics into sections.
pub fn parse_words(rtf: &str) -> Vec<Section> {
    let text = rtf_to_text(rtf);
    let slides: Vec<Vec<String>> = if text.contains(SLIDE_MARKER) {
        text.split(SLIDE_MARKER).map(|s| clean_lines(s.lines())).collect()
    } else {
        split_blank_lines(&text)
    };
    slides
        .into_iter()
        .filter(|lines| !lines.is_empty())
        .filter_map(|mut lines| {
            // Some libraries keep "Verse 1" / "Chorus" as the slide's first line.
            let kind = match section_label(&lines[0]) {
                Some(kind) => {
                    lines.remove(0);
                    kind
                }
                None => SectionKind::Verse,
            };
            (!lines.is_empty()).then_some(Section { kind, lines })
        })
        .collect()
}

fn split_blank_lines(text: &str) -> Vec<Vec<String>> {
    let mut out = vec![Vec::new()];
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            if out.last().is_some_and(|b: &Vec<String>| !b.is_empty()) {
                out.push(Vec::new());
            }
        } else if let Some(last) = out.last_mut() {
            last.push(line.to_string());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_ewsx_schedule() {
        let dir = std::env::temp_dir().join(format!("manna-ewsx-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("main.db");
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch(
            r"CREATE TABLE presentation (title TEXT, author TEXT, copyright TEXT, reference_number TEXT, presentation_type INTEGER, order_index INTEGER);
              CREATE TABLE slide (presentation_id INTEGER, order_index INTEGER);
              CREATE TABLE element (slide_id INTEGER, element_type INTEGER, element_style_type INTEGER, foreground_resource_id INTEGER);
              CREATE TABLE resource_text (resource_id INTEGER, rtf TEXT);
              INSERT INTO presentation VALUES ('Announcements', NULL, NULL, NULL, 2, 2);
              INSERT INTO presentation VALUES ('Way Maker', 'Sinach', NULL, NULL, 6, 1);
              INSERT INTO slide VALUES (2, 1); INSERT INTO slide VALUES (1, 1);
              INSERT INTO element VALUES (1, 6, 4, 10); INSERT INTO element VALUES (2, 1, 1, 11);
              INSERT INTO resource_text VALUES (10, '{\rtf1 Verse 1\par You are here}');
              INSERT INTO resource_text VALUES (11, '{\rtf1 Welcome to church}');",
        )
        .unwrap();
        drop(conn);
        let path = dir.join("Sunday.ewsx");
        super::super::archive::write_zip(&path, &[("main.db", &std::fs::read(&db).unwrap())]);
        let parsed = read_schedule(&path).unwrap();
        let items = &parsed.services[0].items;
        assert!(matches!(&items[0], ServiceItem::Song(s) if s.title == "Way Maker" && s.sections[0].lines == ["You are here"]));
        assert!(matches!(&items[1], ServiceItem::Slides(d) if d.slides == ["Welcome to church"]));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn native_slides_split_on_marker() {
        let rtf = r"{\rtf1{\pard\sdslidemarker\par}{\pard Amazing grace\par}{\pard how sweet\par}{\pard\sdslidemarker\par}{\pard Chorus\par}{\pard Twas grace\par}}";
        let sections = parse_words(rtf);
        assert_eq!(sections.len(), 2);
        assert_eq!(sections[0].lines, vec!["Amazing grace", "how sweet"]);
        assert_eq!(sections[1].kind, SectionKind::Chorus);
        assert_eq!(sections[1].lines, vec!["Twas grace"]);
    }

    #[test]
    fn plain_rtf_splits_on_blank_lines() {
        let rtf = r"{\rtf1 One\par Two\par\par Three\par}";
        let sections = parse_words(rtf);
        assert_eq!(sections.len(), 2);
        assert_eq!(sections[1].lines, vec!["Three"]);
    }

    #[test]
    fn reads_data_dir() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("Default/v6.1/Databases/Data");
        std::fs::create_dir_all(&data).unwrap();
        let songs = Connection::open(data.join(SONGS_DB)).unwrap();
        songs.execute_batch("CREATE TABLE song (title TEXT, author TEXT); INSERT INTO song VALUES ('Way Maker', 'Sinach'), ('Empty', NULL);").unwrap();
        let words = Connection::open(data.join(WORDS_DB)).unwrap();
        words.execute_batch(r"CREATE TABLE word (song_id INTEGER, words TEXT); INSERT INTO word VALUES (1, '{\rtf1 You are here\par moving in our midst\par}');").unwrap();
        drop((songs, words));

        assert_eq!(find_data_dirs(dir.path(), 5), vec![data.clone()]);
        let parsed = read_data_dir(&data).unwrap();
        assert_eq!(parsed.report.found, 2);
        assert_eq!(parsed.songs[0].id, "ew-1");
        assert_eq!(parsed.songs[0].author.as_deref(), Some("Sinach"));
        assert_eq!(parsed.songs[0].sections[0].lines, vec!["You are here", "moving in our midst"]);
        assert!(parsed.songs[1].sections.is_empty());
    }
}
