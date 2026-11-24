//! CCLI SongSelect lyric files.
//!
//! These are the files a church downloads from SongSelect with its own CCLI
//! subscription ("Download → Lyrics"). Two formats exist:
//!
//! * `.txt`: title, blank line, then `Verse 1` / `Chorus` headed blocks,
//!   then a footer with `CCLI Song # …`, authors, `© …` and licence lines.
//! * `.usr` (older, also shipped as `.bin`): INI-style with `[S A<number>]`,
//!   `Title=`, `Author=a | b`, `Fields=Verse 1/tChorus`, `Words=…/n…/t…`.

use std::path::Path;

use super::text::{clean_lines, decode_text, section_label, slug};
use super::{ImportedSong, ParsedSource, Section, SectionKind, SOURCE_CCLI};

pub const EXTENSIONS: &[&str] = &["txt", "usr", "bin"];

pub fn read_files(paths: &[impl AsRef<Path>]) -> ParsedSource {
    let mut parsed = ParsedSource::default();
    for path in paths {
        let path = path.as_ref();
        parsed.report.found += 1;
        let name = path.file_name().map_or_else(|| path.display().to_string(), |n| n.to_string_lossy().into_owned());
        let bytes = match std::fs::read(path) {
            Ok(b) => b,
            Err(e) => {
                parsed.report.fail(name, format!("could not read file: {e}"));
                continue;
            }
        };
        match parse(&decode_text(&bytes)) {
            Some(song) => parsed.songs.push(song),
            None => parsed.report.fail(name, "not a SongSelect lyrics file"),
        }
    }
    parsed
}

/// Parse either format, detected from the content.
pub fn parse(text: &str) -> Option<ImportedSong> {
    if text.trim_start().starts_with("[File]") || text.contains("\nWords=") {
        parse_usr(text)
    } else {
        parse_txt(text)
    }
}

fn song_id(ccli_number: Option<&str>, title: &str) -> String {
    match ccli_number {
        Some(n) => format!("ccli-{n}"),
        None => format!("ccli-{}", slug(title)),
    }
}

/// `"Newton, John"` → `"John Newton"`.
fn natural_name(name: &str) -> String {
    match name.split_once(',') {
        Some((last, first)) if !first.trim().is_empty() => format!("{} {}", first.trim(), last.trim()),
        _ => name.trim().to_string(),
    }
}

fn join_authors(raw: &str) -> Option<String> {
    let names: Vec<String> = raw
        .split('|')
        .map(natural_name)
        .filter(|n| !n.is_empty())
        .collect();
    (!names.is_empty()).then(|| names.join(", "))
}

pub fn parse_usr(text: &str) -> Option<ImportedSong> {
    let mut ccli = None;
    let mut title = String::new();
    let mut author = None;
    let mut fields = "";
    let mut words = "";
    for line in text.lines() {
        let line = line.trim_end_matches('\r');
        if let Some(rest) = line.strip_prefix("[S ") {
            let number: String = rest.chars().filter(char::is_ascii_digit).collect();
            if !number.is_empty() {
                ccli = Some(number);
            }
        } else if let Some(v) = line.strip_prefix("Title=") {
            title = v.trim().to_string();
        } else if let Some(v) = line.strip_prefix("Author=") {
            author = join_authors(v);
        } else if let Some(v) = line.strip_prefix("Fields=") {
            fields = v;
        } else if let Some(v) = line.strip_prefix("Words=") {
            words = v;
        }
    }
    if title.is_empty() || words.is_empty() {
        return None;
    }

    let field_list: Vec<&str> = fields.split("/t").collect();
    let mut sections = Vec::new();
    for (i, chunk) in words.split("/t").enumerate() {
        let label = field_list.get(i).copied().unwrap_or("");
        let mut kind = section_label(label).unwrap_or(SectionKind::Verse);
        let mut lines = clean_lines(chunk.split("/n"));
        // "Misc" fields often open with "(PRE-CHORUS)" / "(BRIDGE)".
        if let Some(first) = lines.first() {
            if first.starts_with('(') && first.ends_with(')') {
                kind = section_label(first).unwrap_or(SectionKind::Other);
                lines.remove(0);
            }
        }
        if !lines.is_empty() {
            sections.push(Section { kind, lines });
        }
    }

    Some(ImportedSong {
        id: song_id(ccli.as_deref(), &title),
        source: SOURCE_CCLI,
        title,
        author,
        sections,
    })
}

fn is_footer_line(line: &str) -> bool {
    let lower = line.to_lowercase();
    lower.starts_with("ccli song")
        || lower.starts_with("ccli licen")
        || lower.starts_with("ccli-liedn")
        || line.starts_with('\u{A9}')
        || lower.starts_with("copyright")
        || lower.contains("songselect")
        || lower.contains("www.ccli.com")
        || lower.contains("all rights reserved")
}

pub fn parse_txt(text: &str) -> Option<ImportedSong> {
    // Blank-line separated blocks of trimmed lines.
    let mut blocks: Vec<Vec<String>> = vec![Vec::new()];
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            if blocks.last().is_some_and(|b| !b.is_empty()) {
                blocks.push(Vec::new());
            }
        } else if let Some(last) = blocks.last_mut() {
            last.push(line.to_string());
        }
    }
    blocks.retain(|b| !b.is_empty());
    if blocks.is_empty() {
        return None;
    }

    // Title is the first line; anything else in that block is lyrics.
    let mut first = blocks.remove(0);
    let title = first.remove(0);
    if !first.is_empty() {
        blocks.insert(0, first);
    }

    let footer_at = blocks
        .iter()
        .position(|b| b.iter().any(|l| is_footer_line(l)))
        .unwrap_or(blocks.len());
    let footer: Vec<String> = blocks.drain(footer_at..).flatten().collect();
    if footer.is_empty() {
        return None;
    }

    let ccli = footer.iter().find_map(|l| {
        let lower = l.to_lowercase();
        lower.starts_with("ccli song").then(|| l.chars().filter(char::is_ascii_digit).collect::<String>())
    });
    let ccli = ccli.filter(|n| !n.is_empty());
    let author = footer
        .iter()
        .find(|l| !is_footer_line(l))
        .and_then(|l| join_authors(l));

    let mut sections = Vec::new();
    let mut carried: Option<SectionKind> = None;
    for mut block in blocks {
        let mut kind = carried.take().unwrap_or(SectionKind::Verse);
        if let Some(label_kind) = section_label(&block[0]) {
            kind = label_kind;
            block.remove(0);
        }
        if block.is_empty() {
            // Heading alone; its lyrics are the next block.
            carried = Some(kind);
            continue;
        }
        sections.push(Section { kind, lines: block });
    }

    Some(ImportedSong {
        id: song_id(ccli.as_deref(), &title),
        source: SOURCE_CCLI,
        title,
        author,
        sections,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const TXT_2023: &str = "Goodness Of God\r\n\r\nVerse 1\r\nI love You Lord\r\nOh Your mercy never fails me\r\n\r\n\r\nChorus\r\nAll my life You have been faithful\r\n\r\n\r\nBridge\r\nYour goodness is running after me\r\n\r\n\r\nEd Cash | Jason Ingram | Jenn Johnson\r\nCCLI Song # 7117726\r\n\u{A9} 2018 Capitol CMG Paragon\r\nFor use solely with the SongSelect\u{AE} Terms of Use.  All rights reserved. www.ccli.com\r\nCCLI License # 1234567\r\n";

    const TXT_OLD: &str = "Above All\n\nVerse 1\nAbove all powers\n\nChorus 1\nCrucified\nLaid behind a stone\n\nCCLI Song # 2672885\nLenny LeBlanc | Paul Baloche\n\u{A9} 1999 Integrity's Hosanna! Music\nFor use solely with the SongSelect Terms of Use.\nCCLI License # 1\n";

    #[test]
    fn parses_2023_txt() {
        let song = parse(TXT_2023).unwrap();
        assert_eq!(song.id, "ccli-7117726");
        assert_eq!(song.title, "Goodness Of God");
        assert_eq!(song.author.as_deref(), Some("Ed Cash, Jason Ingram, Jenn Johnson"));
        let kinds: Vec<_> = song.sections.iter().map(|s| s.kind).collect();
        assert_eq!(kinds, vec![SectionKind::Verse, SectionKind::Chorus, SectionKind::Other]);
        assert_eq!(song.sections[0].lines, vec!["I love You Lord", "Oh Your mercy never fails me"]);
    }

    #[test]
    fn parses_older_txt_footer_order() {
        let song = parse(TXT_OLD).unwrap();
        assert_eq!(song.id, "ccli-2672885");
        assert_eq!(song.author.as_deref(), Some("Lenny LeBlanc, Paul Baloche"));
        assert_eq!(song.sections[1].lines, vec!["Crucified", "Laid behind a stone"]);
    }

    #[test]
    fn parses_usr() {
        let usr = "[File]\r\nType=SongSelect Import File\r\nVersion=3.0\r\n[S A2672885]\r\nTitle=Above All\r\nAuthor=LeBlanc, Lenny | Baloche, Paul\r\nCopyright=1999 Integrity's Hosanna! Music\r\nFields=Verse 1/tChorus 1/tMisc 1\r\nWords=Above all powers/nAbove all kings/tCrucified/nLaid behind a stone/t(PRE-CHORUS)/nYou took the fall/t\r\n";
        let song = parse(usr).unwrap();
        assert_eq!(song.id, "ccli-2672885");
        assert_eq!(song.author.as_deref(), Some("Lenny LeBlanc, Paul Baloche"));
        assert_eq!(song.sections.len(), 3);
        assert_eq!(song.sections[1].kind, SectionKind::Chorus);
        assert_eq!(song.sections[2].kind, SectionKind::Other);
        assert_eq!(song.sections[2].lines, vec!["You took the fall"]);
    }

    #[test]
    fn rejects_random_text() {
        assert!(parse("just some notes\n\nnothing here").is_none());
        assert!(parse("").is_none());
    }
}
