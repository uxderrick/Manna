//! Importers for other worship software (OpenLP, EasyWorship, ProPresenter,
//! CCLI SongSelect).
//!
//! Each importer turns a foreign store into a [`ParsedSource`]: songs, custom
//! slide decks, and services (orders of service). This module writes those
//! into Manna in one transaction: songs into `songs`, and decks and services
//! as service-plan templates. Parsers never touch Manna's DB, so they stay
//! unit-testable. Bibles are imported by `rhema_bible` instead.

// Product names (OpenLP, EasyWorship, SongSelect) read as code to this lint.
#![allow(clippy::doc_markdown)]

mod archive;
pub mod ccli;
pub mod easyworship;
pub mod openlp;
pub mod openlp_service;
mod protobuf;
pub mod propresenter;
mod rtf;
mod text;

use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use serde_json::json;

use crate::plan_models::{PlanItemType, PlanKind};
use crate::{Result, SessionDb};

/// Manna `songs.source` values written by the importers.
pub const SOURCE_OPENLP: &str = "openlp";
pub const SOURCE_EASYWORSHIP: &str = "easyworship";
pub const SOURCE_CCLI: &str = "ccli";
pub const SOURCE_PROPRESENTER: &str = "propresenter";

/// Human name of a source, used in template names.
pub fn source_name(source: &str) -> &str {
    match source {
        SOURCE_OPENLP => "OpenLP",
        SOURCE_EASYWORSHIP => "EasyWorship",
        SOURCE_CCLI => "SongSelect",
        SOURCE_PROPRESENTER => "ProPresenter",
        other => other,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SectionKind {
    Verse,
    Chorus,
    /// Bridge, pre-chorus, tag, ending… shown in order like a verse.
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Section {
    pub kind: SectionKind,
    pub lines: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportedSong {
    /// Stable Manna id, so re-importing the same source updates in place.
    pub id: String,
    pub source: &'static str,
    pub title: String,
    pub author: Option<String>,
    pub sections: Vec<Section>,
}

/// A custom (non-song) slide deck: OpenLP custom slides, a text
/// presentation, a Bible passage inside a service.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportedDeck {
    pub title: String,
    /// One entry per slide; lines separated by `\n`.
    pub slides: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ServiceItem {
    /// A song whose lyrics travel with the service file.
    Song(ImportedSong),
    /// A song referenced only by title (the lyrics live in the library).
    SongTitle(String),
    /// Text slides (custom slides, scripture, announcements).
    Slides(ImportedDeck),
    /// A header / section divider.
    Header(String),
    /// Media, images, presentations... kept as a labelled placeholder.
    Unsupported { kind: String, title: String },
}

/// An order of service: OpenLP service, EasyWorship schedule, ProPresenter
/// playlist. Becomes a service-plan template.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportedService {
    pub name: String,
    pub source: &'static str,
    pub items: Vec<ServiceItem>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportFailure {
    pub item: String,
    pub reason: String,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    /// Songs found in the source (including ones that failed to parse).
    pub found: usize,
    pub imported: usize,
    pub updated: usize,
    pub skipped_existing: usize,
    pub failed: Vec<ImportFailure>,
    /// Plan templates written (custom slides, services).
    pub templates: Vec<String>,
    /// Templates left alone because one with that name already exists.
    pub templates_skipped: Vec<String>,
    /// Service songs matched to a song already in Manna by title.
    pub songs_linked: usize,
}

impl ImportReport {
    pub fn fail(&mut self, item: impl Into<String>, reason: impl Into<String>) {
        self.failed.push(ImportFailure { item: item.into(), reason: reason.into() });
    }
}

/// Result of reading a source: everything parsed plus per-item failures.
#[derive(Debug, Default)]
pub struct ParsedSource {
    pub songs: Vec<ImportedSong>,
    /// Custom slide decks, grouped into one template per source.
    pub decks: Vec<(&'static str, ImportedDeck)>,
    pub services: Vec<ImportedService>,
    pub report: ImportReport,
}

impl ParsedSource {
    /// Fold another source into this one (e.g. a folder holding several files).
    pub fn merge(&mut self, other: ParsedSource) {
        self.songs.extend(other.songs);
        self.decks.extend(other.decks);
        self.services.extend(other.services);
        let r = other.report;
        self.report.found += r.found;
        self.report.failed.extend(r.failed);
    }

    pub fn is_empty(&self) -> bool {
        self.songs.is_empty() && self.decks.is_empty() && self.services.is_empty()
    }
}

/// Build Manna's `songs.data` JSON.
///
/// Manna models a song as ordered verse stanzas plus one chorus that
/// `autoChorus` repeats after every stanza. The first chorus becomes that
/// chorus; repeats of it are dropped; a different second chorus stays in
/// order as a stanza. A chorus-only song keeps its chorus as a plain stanza,
/// because playback walks `stanzas` and would otherwise show nothing.
pub fn song_data_json(sections: &[Section]) -> String {
    let has_non_chorus = sections.iter().any(|s| s.kind != SectionKind::Chorus);
    let chorus = if has_non_chorus {
        sections.iter().find(|s| s.kind == SectionKind::Chorus)
    } else {
        None
    };

    let mut stanzas = Vec::new();
    for section in sections {
        if let Some(ch) = chorus {
            if section.kind == SectionKind::Chorus && section.lines == ch.lines {
                continue;
            }
        }
        stanzas.push(json!({
            "id": format!("v{}", stanzas.len() + 1),
            "kind": "verse",
            "lines": section.lines,
        }));
    }

    json!({
        "stanzas": stanzas,
        "chorus": chorus.map(|c| json!({ "id": "ch", "kind": "chorus", "lines": c.lines })),
        "autoChorus": chorus.is_some(),
        "lineMode": "stanza-pair",
    })
    .to_string()
}

fn has_chorus(data: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(data)
        .ok()
        .and_then(|v| v.get("autoChorus").and_then(serde_json::Value::as_bool))
        .unwrap_or(false)
}

fn song_item_json(song_id: &str, data: &str) -> String {
    json!({ "songId": song_id, "autoChorus": has_chorus(data), "lineMode": "stanza-pair" }).to_string()
}

fn slide_item_json(title: &str, body: &str) -> String {
    json!({ "title": title, "body": body, "mode": "slide", "duration": null }).to_string()
}

fn section_item_json(label: &str) -> String {
    json!({ "label": label }).to_string()
}

/// Items of a plan template, before they are written.
type TemplateItems = Vec<(PlanItemType, String)>;

fn deck_items(deck: &ImportedDeck, items: &mut TemplateItems) {
    for slide in deck.slides.iter().filter(|s| !s.trim().is_empty()) {
        items.push((PlanItemType::Announcement, slide_item_json(&deck.title, slide)));
    }
}

impl SessionDb {
    /// Write imported songs only (kept for callers that import song files).
    pub fn import_songs(&self, parsed: ParsedSource, overwrite: bool) -> Result<ImportReport> {
        self.import_content(parsed, overwrite)
    }

    /// Write everything in one transaction. Songs whose id already exists are
    /// skipped unless `overwrite`, so operator edits survive a re-import; the
    /// same goes for templates with an existing name.
    pub fn import_content(&self, parsed: ParsedSource, overwrite: bool) -> Result<ImportReport> {
        let ParsedSource { songs, decks, services, mut report } = parsed;
        let tx = self.conn().unchecked_transaction()?;
        for song in songs {
            self.write_song(song, overwrite, &mut report)?;
        }

        let mut by_source: Vec<(&'static str, TemplateItems)> = Vec::new();
        for (source, deck) in &decks {
            let idx = by_source.iter().position(|(s, _)| s == source).unwrap_or_else(|| {
                by_source.push((source, Vec::new()));
                by_source.len() - 1
            });
            let items = &mut by_source[idx].1;
            items.push((PlanItemType::Section, section_item_json(&deck.title)));
            deck_items(deck, items);
        }
        for (source, items) in by_source {
            let name = format!("{} custom slides", source_name(source));
            self.write_template(&name, &items, overwrite, &mut report)?;
        }

        for service in services {
            let mut items = TemplateItems::new();
            for item in service.items {
                match item {
                    ServiceItem::Song(song) => {
                        if let Some((id, data)) = self.resolve_service_song(song, &mut report)? {
                            items.push((PlanItemType::Song, song_item_json(&id, &data)));
                        }
                    }
                    ServiceItem::SongTitle(title) => match self.find_song_by_title(&title)? {
                        Some((id, data)) => {
                            report.songs_linked += 1;
                            items.push((PlanItemType::Song, song_item_json(&id, &data)));
                        }
                        None => items.push((
                            PlanItemType::Section,
                            section_item_json(&format!("Song not in Manna: {title}")),
                        )),
                    },
                    ServiceItem::Slides(deck) => deck_items(&deck, &mut items),
                    ServiceItem::Header(label) => items.push((PlanItemType::Section, section_item_json(&label))),
                    ServiceItem::Unsupported { kind, title } => items.push((
                        PlanItemType::Section,
                        section_item_json(&format!("{kind}: {title} (not imported)")),
                    )),
                }
            }
            let name = format!("{} ({})", service.name.trim(), source_name(service.source));
            self.write_template(&name, &items, overwrite, &mut report)?;
        }
        tx.commit()?;
        Ok(report)
    }

    fn write_song(&self, song: ImportedSong, overwrite: bool, report: &mut ImportReport) -> Result<Option<String>> {
        if song.title.trim().is_empty() {
            report.fail(song.id, "missing title");
            return Ok(None);
        }
        if song.sections.iter().all(|s| s.lines.is_empty()) {
            report.fail(song.title, "no lyrics");
            return Ok(None);
        }
        let conn = self.conn();
        let already = conn.prepare_cached("SELECT 1 FROM songs WHERE id = ?1")?.exists(params![song.id])?;
        if already && !overwrite {
            report.skipped_existing += 1;
            return Ok(Some(song.id));
        }
        let data = song_data_json(&song.sections);
        conn.prepare_cached(
            "INSERT INTO songs (id, source, number, title, author, data, seed_version)
             VALUES (?1, ?2, NULL, ?3, ?4, ?5, 0)
             ON CONFLICT(id) DO UPDATE SET
                source = ?2, title = ?3, author = ?4, data = ?5,
                updated_at = datetime('now')",
        )?
        .execute(params![song.id, song.source, song.title.trim(), song.author, data])?;
        if already {
            report.updated += 1;
        } else {
            report.imported += 1;
        }
        Ok(Some(song.id))
    }

    fn song_data(&self, id: &str) -> Result<Option<String>> {
        Ok(self
            .conn()
            .prepare_cached("SELECT data FROM songs WHERE id = ?1")?
            .query_row(params![id], |r| r.get(0))
            .optional()?)
    }

    /// First song whose title matches, ignoring case and outer spaces.
    fn find_song_by_title(&self, title: &str) -> Result<Option<(String, String)>> {
        Ok(self
            .conn()
            .prepare_cached(
                "SELECT id, data FROM songs WHERE lower(trim(title)) = lower(trim(?1))
                 ORDER BY updated_at DESC LIMIT 1",
            )?
            .query_row(params![title], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()?)
    }

    /// A song carried inside a service: reuse the library copy when the same
    /// id or title is already in Manna, otherwise add it.
    fn resolve_service_song(&self, song: ImportedSong, report: &mut ImportReport) -> Result<Option<(String, String)>> {
        if let Some(data) = self.song_data(&song.id)? {
            report.songs_linked += 1;
            return Ok(Some((song.id, data)));
        }
        if let Some(found) = self.find_song_by_title(&song.title)? {
            report.songs_linked += 1;
            return Ok(Some(found));
        }
        report.found += 1;
        let Some(id) = self.write_song(song, false, report)? else { return Ok(None) };
        Ok(self.song_data(&id)?.map(|data| (id, data)))
    }

    /// Create a template, or replace a same-named one when `overwrite`.
    fn write_template(
        &self,
        name: &str,
        items: &TemplateItems,
        overwrite: bool,
        report: &mut ImportReport,
    ) -> Result<()> {
        if items.is_empty() {
            return Ok(());
        }
        let existing: Option<i64> = self
            .conn()
            .query_row("SELECT id FROM service_plan_templates WHERE name = ?1", params![name], |r| r.get(0))
            .optional()?;
        if let Some(id) = existing {
            if !overwrite {
                report.templates_skipped.push(name.to_string());
                return Ok(());
            }
            self.conn()
                .execute("DELETE FROM service_plan_items WHERE plan_id = ?1 AND plan_kind = 'template'", params![id])?;
            self.conn().execute("DELETE FROM service_plan_templates WHERE id = ?1", params![id])?;
        }
        let template = self.create_template(name, Some("Imported"))?;
        for (i, (kind, data)) in items.iter().enumerate() {
            #[expect(clippy::cast_precision_loss, reason = "item counts are far below 2^52")]
            let order = (i + 1) as f64;
            self.add_plan_item(template.id, PlanKind::Template, *kind, data, order, None)?;
        }
        report.templates.push(name.to_string());
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sec(kind: SectionKind, lines: &[&str]) -> Section {
        Section { kind, lines: lines.iter().map(|s| (*s).to_string()).collect() }
    }

    fn song(id: &str, sections: Vec<Section>) -> ImportedSong {
        ImportedSong {
            id: id.into(),
            source: SOURCE_OPENLP,
            title: "Test".into(),
            author: Some("A".into()),
            sections,
        }
    }

    #[test]
    fn first_chorus_becomes_auto_chorus_and_repeats_drop() {
        let data: serde_json::Value = serde_json::from_str(&song_data_json(&[
            sec(SectionKind::Verse, &["v1"]),
            sec(SectionKind::Chorus, &["ch"]),
            sec(SectionKind::Other, &["bridge"]),
            sec(SectionKind::Chorus, &["ch"]),
            sec(SectionKind::Chorus, &["ch2"]),
        ]))
        .unwrap();
        assert_eq!(data["autoChorus"], true);
        assert_eq!(data["chorus"]["lines"][0], "ch");
        let stanzas: Vec<_> = data["stanzas"].as_array().unwrap().iter().map(|s| s["lines"][0].clone()).collect();
        assert_eq!(stanzas, vec!["v1", "bridge", "ch2"]);
        assert_eq!(data["stanzas"][2]["id"], "v3");
    }

    #[test]
    fn chorus_only_song_keeps_chorus_as_stanza() {
        let data: serde_json::Value =
            serde_json::from_str(&song_data_json(&[sec(SectionKind::Chorus, &["only"])])).unwrap();
        assert_eq!(data["autoChorus"], false);
        assert!(data["chorus"].is_null());
        assert_eq!(data["stanzas"][0]["lines"][0], "only");
    }

    #[test]
    fn import_skips_existing_unless_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        let db = SessionDb::open(&dir.path().join("t.db")).unwrap();
        let parsed = || ParsedSource {
            songs: vec![
                song("openlp-1", vec![sec(SectionKind::Verse, &["a"])]),
                song("openlp-2", vec![]),
            ],
            report: ImportReport { found: 2, ..Default::default() },
            ..Default::default()
        };

        let first = db.import_songs(parsed(), false).unwrap();
        assert_eq!((first.imported, first.updated, first.skipped_existing), (1, 0, 0));
        assert_eq!(first.failed.len(), 1);

        let again = db.import_songs(parsed(), false).unwrap();
        assert_eq!((again.imported, again.skipped_existing), (0, 1));

        let forced = db.import_songs(parsed(), true).unwrap();
        assert_eq!((forced.imported, forced.updated), (0, 1));
        assert_eq!(db.count_songs_by_source(SOURCE_OPENLP).unwrap(), 1);
    }

    #[test]
    fn services_and_decks_become_templates_linking_existing_songs() {
        let dir = tempfile::tempdir().unwrap();
        let db = SessionDb::open(&dir.path().join("t.db")).unwrap();
        db.import_songs(
            ParsedSource { songs: vec![song("openlp-1", vec![sec(SectionKind::Chorus, &["c"]), sec(SectionKind::Verse, &["v"])])], ..Default::default() },
            false,
        )
        .unwrap();

        let mut carried = song("ew-schedule-new", vec![sec(SectionKind::Verse, &["new"])]);
        carried.title = "Brand New".into();
        let mut same_title = song("pp-x", vec![sec(SectionKind::Verse, &["dup"])]);
        same_title.title = " test ".into(); // matches "Test" already in Manna
        let parsed = || ParsedSource {
            decks: vec![(SOURCE_OPENLP, ImportedDeck { title: "Welcome".into(), slides: vec!["Hello".into(), " ".into()] })],
            services: vec![ImportedService {
                name: "Sunday".into(),
                source: SOURCE_EASYWORSHIP,
                items: vec![
                    ServiceItem::Header("Worship".into()),
                    ServiceItem::Song(same_title.clone()),
                    ServiceItem::Song(carried.clone()),
                    ServiceItem::SongTitle("Missing".into()),
                    ServiceItem::Slides(ImportedDeck { title: "John 3:16".into(), slides: vec!["For God so loved".into()] }),
                    ServiceItem::Unsupported { kind: "Image".into(), title: "logo.png".into() },
                ],
            }],
            ..Default::default()
        };

        let report = db.import_content(parsed(), false).unwrap();
        assert_eq!(report.templates, ["OpenLP custom slides", "Sunday (EasyWorship)"]);
        assert_eq!((report.songs_linked, report.imported), (1, 1));

        let templates = db.list_templates().unwrap();
        let sunday = templates.iter().find(|t| t.name == "Sunday (EasyWorship)").unwrap();
        let plan = db.get_plan(sunday.id, PlanKind::Template).unwrap();
        let kinds: Vec<_> = plan.items.iter().map(|i| i.item_type.as_str()).collect();
        assert_eq!(kinds, ["section", "song", "song", "section", "announcement", "section"]);
        assert!(plan.items[1].item_data.contains(r#""songId":"openlp-1""#));
        assert!(plan.items[1].item_data.contains(r#""autoChorus":true"#));
        assert!(plan.items[3].item_data.contains("Song not in Manna: Missing"));
        let deck = templates.iter().find(|t| t.name == "OpenLP custom slides").unwrap();
        assert_eq!(db.get_plan(deck.id, PlanKind::Template).unwrap().items.len(), 2, "section + one non-blank slide");

        let again = db.import_content(parsed(), false).unwrap();
        assert!(again.templates.is_empty());
        assert_eq!(again.templates_skipped.len(), 2);
        let replaced = db.import_content(parsed(), true).unwrap();
        assert_eq!(replaced.templates.len(), 2);
        assert_eq!(db.list_templates().unwrap().len(), 2, "overwrite replaces instead of duplicating");
    }
}
