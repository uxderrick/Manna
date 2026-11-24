//! Import songs, custom slides, services and Bibles from other worship
//! software (OpenLP, EasyWorship, ProPresenter, CCLI SongSelect, Bible XML).
//!
//! Parsing lives in `rhema_notes::import` (songs, slides, services) and
//! `rhema_bible` (Bibles). This module finds default library locations,
//! works out what each chosen file or folder contains, and writes it.

// Product names (OpenLP, EasyWorship, ProPresenter) read as code to this lint.
#![allow(clippy::doc_markdown)]

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rhema_notes::import::{ccli, easyworship, openlp, openlp_service, propresenter, ImportReport, ParsedSource};
use rhema_notes::SessionDb;
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use tauri::State;

use crate::state::AppState;

type DbState = Mutex<SessionDb>;

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DetectedSource {
    /// `"openlp"`, `"easyworship"` or `"propresenter"`.
    pub kind: &'static str,
    pub path: String,
    /// Short human label, e.g. the EasyWorship profile or ProPresenter library.
    pub label: String,
    /// What was found, e.g. `["175 songs", "4 Bibles"]`.
    pub contents: Vec<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ContentImportResult {
    pub report: ImportReport,
    pub bibles: Vec<rhema_bible::BibleImportReport>,
}

fn push_unique(out: &mut Vec<PathBuf>, path: Option<PathBuf>) {
    if let Some(p) = path {
        if !out.contains(&p) {
            out.push(p);
        }
    }
}

fn plural(n: usize, one: &str, many: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { many })
}

// ------------------------------------------------------------- detection

/// OpenLP's own folder (`…/openlp`), which holds `Data/songs`, `Data/bibles`…
fn openlp_roots() -> Vec<PathBuf> {
    let mut bases = Vec::new();
    push_unique(&mut bases, dirs::data_dir());
    push_unique(&mut bases, dirs::data_local_dir());
    bases.into_iter().map(|b| b.join("openlp")).filter(|p| openlp_data_dir(p).is_some()).collect()
}

/// The `Data` folder of an OpenLP root, or the folder itself when the user
/// picked `Data` directly.
fn openlp_data_dir(path: &Path) -> Option<PathBuf> {
    let looks_like_data = |d: &Path| ["songs", "bibles", "custom"].iter().any(|s| d.join(s).is_dir());
    ["Data", "data"]
        .iter()
        .map(|d| path.join(d))
        .chain(std::iter::once(path.to_path_buf()))
        .find(|d| looks_like_data(d))
}

fn sqlite_tables(path: &Path) -> BTreeSet<String> {
    let Ok(conn) = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
    else {
        return BTreeSet::new();
    };
    conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .and_then(|mut s| s.query_map([], |r| r.get::<_, String>(0))?.collect::<Result<BTreeSet<_>, _>>())
        .unwrap_or_default()
}

fn count_rows(path: &Path, table: &str) -> usize {
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .and_then(|c| c.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get::<_, i64>(0)))
        .ok()
        .and_then(|n| usize::try_from(n).ok())
        .unwrap_or(0)
}

fn files_with_ext(dir: &Path, exts: &[&str]) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut out: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file() && p.extension().and_then(|e| e.to_str()).is_some_and(|e| exts.contains(&e.to_lowercase().as_str())))
        .collect();
    out.sort();
    out
}

fn openlp_contents(data: &Path) -> Vec<String> {
    let mut out = Vec::new();
    let songs = count_rows(&data.join("songs/songs.sqlite"), "songs");
    if songs > 0 {
        out.push(plural(songs, "song", "songs"));
    }
    let custom = count_rows(&data.join("custom/custom.sqlite"), "custom_slide");
    if custom > 0 {
        out.push(plural(custom, "custom slide", "custom slides"));
    }
    let bibles = files_with_ext(&data.join("bibles"), &["sqlite"]).len();
    if bibles > 0 {
        out.push(plural(bibles, "Bible", "Bibles"));
    }
    out
}

fn easyworship_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(docs) = dirs::document_dir() {
        // macOS/Linux copies of a backup, and per-user Windows installs.
        push_unique(&mut roots, Some(docs.join("EasyWorship")));
        push_unique(&mut roots, Some(docs.join("Softouch").join("EasyWorship")));
    }
    // Default Windows install keeps data in the Public documents folder.
    if let Some(public) = std::env::var_os("PUBLIC") {
        push_unique(&mut roots, Some(PathBuf::from(public).join("Documents").join("Softouch").join("EasyWorship")));
    }
    roots
}

/// Label for an EasyWorship data dir: its profile folder (first component
/// below the root), falling back to the folder name.
fn ew_label(root: &Path, data_dir: &Path) -> String {
    data_dir
        .strip_prefix(root)
        .ok()
        .and_then(|rel| rel.components().next())
        .map_or_else(|| data_dir.display().to_string(), |c| c.as_os_str().to_string_lossy().into_owned())
}

/// ProPresenter libraries: v7 keeps one folder per library under
/// `Documents/ProPresenter/Libraries`, v6 uses `Documents/ProPresenter6`.
fn propresenter_libraries() -> Vec<(String, PathBuf)> {
    let Some(docs) = dirs::document_dir() else { return Vec::new() };
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(docs.join("ProPresenter").join("Libraries")) {
        let mut libs: Vec<PathBuf> = entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
        libs.sort();
        for lib in libs {
            let name = lib.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            out.push((format!("ProPresenter 7 · {name}"), lib));
        }
    }
    let pro6 = docs.join("ProPresenter6");
    if pro6.is_dir() {
        out.push(("ProPresenter 6".to_string(), pro6));
    }
    out
}

fn detect() -> Vec<DetectedSource> {
    let mut found = Vec::new();
    for root in openlp_roots() {
        let Some(data) = openlp_data_dir(&root) else { continue };
        let contents = openlp_contents(&data);
        if !contents.is_empty() {
            found.push(DetectedSource {
                kind: "openlp",
                path: root.display().to_string(),
                label: "OpenLP".into(),
                contents,
            });
        }
    }
    for root in easyworship_roots() {
        for dir in easyworship::find_data_dirs(&root, 4) {
            let songs = count_rows(&dir.join("Songs.db"), "song");
            found.push(DetectedSource {
                kind: "easyworship",
                label: format!("EasyWorship · {}", ew_label(&root, &dir)),
                path: dir.display().to_string(),
                contents: vec![plural(songs, "song", "songs")],
            });
        }
    }
    for (label, dir) in propresenter_libraries() {
        let docs = files_with_ext(&dir, propresenter::DOCUMENT_EXTENSIONS).len();
        if docs > 0 {
            found.push(DetectedSource {
                kind: "propresenter",
                label,
                path: dir.display().to_string(),
                contents: vec![plural(docs, "presentation", "presentations")],
            });
        }
    }
    found
}

#[tauri::command]
pub async fn detect_import_sources() -> Result<Vec<DetectedSource>, String> {
    tauri::async_runtime::spawn_blocking(detect).await.map_err(|e| e.to_string())
}

// ------------------------------------------------------------ classifying

/// Everything found in the chosen paths: content for the session DB plus
/// Bible files for the Bible store.
#[derive(Default)]
struct Plan {
    content: ParsedSource,
    bibles: Vec<PathBuf>,
}

impl Plan {
    fn add(&mut self, result: Result<ParsedSource, String>, path: &Path) {
        match result {
            Ok(parsed) => self.content.merge(parsed),
            Err(e) => self.content.report.fail(display_name(path), e),
        }
    }
}

fn display_name(path: &Path) -> String {
    path.file_name().map_or_else(|| path.display().to_string(), |n| n.to_string_lossy().into_owned())
}

fn ext(path: &Path) -> String {
    path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase()
}

fn classify_openlp_data(data: &Path, plan: &mut Plan) {
    let songs = data.join("songs/songs.sqlite");
    if songs.is_file() {
        plan.add(openlp::read_db(&songs), &songs);
    }
    let custom = data.join("custom/custom.sqlite");
    if custom.is_file() {
        plan.add(openlp_service::read_custom_db(&custom), &custom);
    }
    plan.bibles.extend(files_with_ext(&data.join("bibles"), &["sqlite"]));
}

fn classify_sqlite(path: &Path, plan: &mut Plan) {
    let tables = sqlite_tables(path);
    let has = |t: &str| tables.contains(t);
    if has("songs") && has("authors") {
        plan.add(openlp::read_db(path), path);
    } else if has("custom_slide") {
        plan.add(openlp_service::read_custom_db(path), path);
    } else if has("verse") && has("book") && has("metadata") {
        plan.bibles.push(path.to_path_buf());
    } else if has("song") {
        let dir = path.parent().unwrap_or(path);
        plan.add(easyworship::read_data_dir(dir), path);
    } else {
        plan.content.report.fail(display_name(path), "not a song, custom slide or Bible database");
    }
}

fn classify_file(path: &Path, plan: &mut Plan) {
    match ext(path).as_str() {
        "sqlite" | "db" => classify_sqlite(path, plan),
        e if propresenter::DOCUMENT_EXTENSIONS.contains(&e) => {
            plan.content.merge(propresenter::read_documents(&[path.to_path_buf()]));
        }
        e if propresenter::PLAYLIST_EXTENSIONS.contains(&e) => plan.add(propresenter::read_playlist(path), path),
        e if openlp_service::SERVICE_EXTENSIONS.contains(&e) => plan.add(openlp_service::read_service(path), path),
        easyworship::SCHEDULE_EXTENSION => plan.add(easyworship::read_schedule(path), path),
        e if ccli::EXTENSIONS.contains(&e) => plan.content.merge(ccli::read_files(&[path])),
        "xml" | "osis" | "zefania" | "zef" => plan.bibles.push(path.to_path_buf()),
        _ => plan.content.report.fail(display_name(path), "file type not supported"),
    }
}

fn classify_dir(dir: &Path, plan: &mut Plan, depth: usize) {
    if let Some(data) = openlp_data_dir(dir) {
        classify_openlp_data(&data, plan);
        return;
    }
    let ew = easyworship::find_data_dirs(dir, 5);
    match ew.as_slice() {
        [] => {}
        [one] => {
            plan.add(easyworship::read_data_dir(one), one);
            return;
        }
        many => {
            plan.content.report.fail(
                display_name(dir),
                format!(
                    "contains {} EasyWorship profiles; choose one profile folder: {}",
                    many.len(),
                    many.iter().map(|d| ew_label(dir, d)).collect::<Vec<_>>().join(", ")
                ),
            );
            return;
        }
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        plan.content.report.fail(display_name(dir), "folder could not be read");
        return;
    };
    let mut paths: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
    paths.sort();
    let documents: Vec<PathBuf> = paths.iter().filter(|p| propresenter::is_document(p)).cloned().collect();
    if !documents.is_empty() {
        plan.content.merge(propresenter::read_documents(&documents));
    }
    for path in paths.iter().filter(|p| !propresenter::is_document(p)) {
        if path.is_dir() {
            if depth > 0 {
                classify_dir(path, plan, depth - 1);
            }
        } else if supported_extension(path) {
            classify_file(path, plan);
        }
    }
}

/// Inside folders, only look at files that can be imported (a folder of
/// mixed documents should not report every PDF as a failure).
fn supported_extension(path: &Path) -> bool {
    let e = ext(path);
    propresenter::PLAYLIST_EXTENSIONS.contains(&e.as_str())
        || openlp_service::SERVICE_EXTENSIONS.contains(&e.as_str())
        || e == easyworship::SCHEDULE_EXTENSION
        || matches!(e.as_str(), "usr" | "osis" | "zefania" | "zef")
}

fn classify(paths: &[String]) -> Result<Plan, String> {
    if paths.is_empty() {
        return Err("No file or folder chosen".into());
    }
    let mut plan = Plan::default();
    for raw in paths {
        let path = PathBuf::from(raw);
        if path.is_dir() {
            classify_dir(&path, &mut plan, 2);
        } else if path.is_file() {
            classify_file(&path, &mut plan);
        } else {
            plan.content.report.fail(display_name(&path), "not found");
        }
    }
    Ok(plan)
}

// ---------------------------------------------------------------- import

#[tauri::command]
pub async fn import_content(
    db: State<'_, DbState>,
    app: State<'_, Mutex<AppState>>,
    paths: Vec<String>,
    overwrite: bool,
) -> Result<ContentImportResult, String> {
    let plan = tauri::async_runtime::spawn_blocking(move || classify(&paths)).await.map_err(|e| e.to_string())??;
    let Plan { content, bibles: bible_files } = plan;

    let mut report = if content.is_empty() {
        content.report
    } else {
        db.lock().map_err(|e| e.to_string())?.import_content(content, overwrite).map_err(|e| e.to_string())?
    };

    let parsed_bibles = tauri::async_runtime::spawn_blocking(move || {
        bible_files.into_iter().map(|p| (display_name(&p), rhema_bible::parse_bible_file(&p))).collect::<Vec<_>>()
    })
    .await
    .map_err(|e| e.to_string())?;

    let mut bibles = Vec::new();
    if !parsed_bibles.is_empty() {
        // Hold the app lock only to grab the store; the write has its own lock.
        let store = {
            let state = app.lock().map_err(|e| e.to_string())?;
            let bible_db = state.bible_db.as_ref().ok_or("Bible database not loaded")?;
            bible_db.user_store().ok_or("Imported Bibles are not available in this session")?
        };
        for (name, parsed) in parsed_bibles {
            let outcome = parsed
                .and_then(|b| store.import_bible(&b, overwrite))
                .map_err(|e| e.to_string());
            match outcome {
                Ok(r) => bibles.push(r),
                Err(e) => report.fail(name, e),
            }
        }
    }
    Ok(ContentImportResult { report, bibles })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ew_label_is_profile_folder() {
        let root = Path::new("/docs/EasyWorship");
        assert_eq!(ew_label(root, Path::new("/docs/EasyWorship/Sunday/v6.1/Databases/Data")), "Sunday");
    }

    #[test]
    fn unknown_and_missing_paths_are_reported_not_fatal() {
        assert!(classify(&[]).is_err());
        let dir = tempfile::tempdir().unwrap();
        let pdf = dir.path().join("notes.pdf");
        std::fs::write(&pdf, b"%PDF").unwrap();
        let plan = classify(&[pdf.display().to_string(), "/no/such/file.pro".into()]).unwrap();
        assert_eq!(plan.content.report.failed.len(), 2);
    }

    #[test]
    fn openlp_folder_collects_songs_custom_and_bibles() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("openlp").join("Data");
        for sub in ["songs", "custom", "bibles"] {
            std::fs::create_dir_all(data.join(sub)).unwrap();
        }
        Connection::open(data.join("custom/custom.sqlite"))
            .unwrap()
            .execute_batch(
                "CREATE TABLE custom_slide (id INTEGER PRIMARY KEY, title TEXT, text TEXT);
                 INSERT INTO custom_slide (title, text) VALUES ('Hi', '<song><lyrics><verse type=\"custom\" label=\"1\"><![CDATA[Hello]]></verse></lyrics></song>');",
            )
            .unwrap();
        std::fs::write(data.join("bibles/KJV.sqlite"), b"").unwrap();
        let plan = classify(&[dir.path().join("openlp").display().to_string()]).unwrap();
        assert_eq!(plan.content.decks.len(), 1);
        assert_eq!(plan.bibles.len(), 1);
    }
}

