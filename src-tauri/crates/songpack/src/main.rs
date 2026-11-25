//! `manna-songpack`: turn recordings of whole songs into a song pack that
//! any Manna install can import (Songs panel, "Import song pack").
//!
//! ```text
//! manna-songpack build <audio files or folders>... --out church.mannasongs
//!                      [--titles titles.csv] [--model clews_int8.onnx]
//! manna-songpack list church.mannasongs
//! ```
//!
//! Each file is one song; its title is the file name ("No One Like the
//! Lord.m4a"), leading track numbers and underscores aside, or a line of
//! `--titles` (`file name,title[,artist]`). Building into an existing pack
//! adds to it, so a library can grow a few songs at a time.

mod audio;

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use rhema_songmatch::pack::{SongPack, PACK_EXTENSION};

/// Must match the app's model id: other models' packs are refused there.
const MODEL_ID: &str = "clews-dvi-int8-v1";
const MODEL_RELATIVE: &str = "models/songmatch/clews_int8.onnx";
/// Shorter recordings say too little about a song.
const MIN_SECONDS: f32 = 10.0;

fn usage() -> ExitCode {
    eprintln!(
        "usage:\n  manna-songpack build <audio files or folders>... --out FILE.{PACK_EXTENSION} [--titles titles.csv] [--model clews_int8.onnx]\n  manna-songpack list FILE.{PACK_EXTENSION}"
    );
    ExitCode::from(2)
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("build") => build(&args[1..]),
        Some("list") if args.len() == 2 => list(Path::new(&args[1])),
        _ => return usage(),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}

/// A song title from a file name: `03 - No_One_Like_the_Lord.m4a` → "No One Like the Lord".
fn title_from_file(path: &Path) -> String {
    let stem = path.file_stem().map(|s| s.to_string_lossy().replace('_', " ")).unwrap_or_default();
    let rest = stem.trim_start_matches(|c: char| c.is_ascii_digit());
    // Only strip a track number: one or two digits, then a separator.
    let digits = stem.len() - rest.len();
    let rest = if (1..=2).contains(&digits) && rest.starts_with([' ', '.', '-', ')']) {
        rest.trim_start_matches([' ', '.', '-', ')'])
    } else {
        stem.as_str()
    };
    rest.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// `file name,title[,artist]` lines (a header line is fine: it matches no file).
fn read_titles(path: &Path) -> Result<Vec<(String, String, Option<String>)>, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(text
        .lines()
        .filter_map(|line| {
            let mut cells = line.split(',').map(str::trim);
            let file = cells.next().filter(|f| !f.is_empty())?;
            let title = cells.next().filter(|t| !t.is_empty())?;
            let artist = cells.next().filter(|a| !a.is_empty()).map(String::from);
            Some((file.to_string(), title.to_string(), artist))
        })
        .collect())
}

fn is_audio(path: &Path) -> bool {
    path.extension().is_some_and(|e| audio::EXTENSIONS.iter().any(|x| e.eq_ignore_ascii_case(x)))
}

fn collect(inputs: &[PathBuf]) -> Vec<PathBuf> {
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        let mut paths: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
        paths.sort();
        for p in paths {
            if p.is_dir() {
                walk(&p, out);
            } else if is_audio(&p) {
                out.push(p);
            }
        }
    }
    let mut out = Vec::new();
    for input in inputs {
        if input.is_dir() {
            walk(input, &mut out);
        } else {
            out.push(input.clone());
        }
    }
    out
}

fn model_path(given: Option<PathBuf>) -> Result<PathBuf, String> {
    let candidates = given.into_iter().chain([
        PathBuf::from(MODEL_RELATIVE),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..").join(MODEL_RELATIVE),
    ]);
    candidates
        .into_iter()
        .find(|p| p.is_file())
        .ok_or_else(|| format!("song model not found ({MODEL_RELATIVE}); pass --model"))
}

fn build(args: &[String]) -> Result<(), String> {
    let mut inputs = Vec::new();
    let (mut out, mut titles, mut model) = (None, None, None);
    let mut it = args.iter();
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--out" => out = it.next().map(PathBuf::from),
            "--titles" => titles = it.next().map(PathBuf::from),
            "--model" => model = it.next().map(PathBuf::from),
            other => inputs.push(PathBuf::from(other)),
        }
    }
    let out = out.ok_or("missing --out FILE")?;
    let files = collect(&inputs);
    if files.is_empty() {
        return Err("no audio files given (mp3, m4a, wav, flac)".into());
    }
    let titles = titles.map(|t| read_titles(&t)).transpose()?.unwrap_or_default();
    let mut pack = if out.is_file() {
        let pack = SongPack::from_json(&std::fs::read_to_string(&out).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        if pack.model != MODEL_ID {
            return Err(format!("{} was made with another model ({})", out.display(), pack.model));
        }
        println!("Adding to {} ({} songs)", out.display(), pack.songs.len());
        pack
    } else {
        SongPack::new(MODEL_ID)
    };
    let embedder = load_embedder(&model_path(model)?)?;

    let (mut added, mut failed) = (0, 0);
    for file in &files {
        let name = file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let (title, artist) = titles
            .iter()
            .find(|(f, ..)| f.eq_ignore_ascii_case(&name))
            .map_or_else(|| (title_from_file(file), None), |(_, t, a)| (t.clone(), a.clone()));
        let started = std::time::Instant::now();
        match fingerprint(embedder.as_ref(), file, &name) {
            Ok(recording) => {
                let seconds = recording.seconds;
                let windows = recording.windows;
                pack.add(&title, artist.as_deref(), recording);
                added += 1;
                println!("  ok  {title}  ({}, {windows} windows, {:.1} s)", clock(seconds), started.elapsed().as_secs_f32());
            }
            Err(e) => {
                failed += 1;
                println!("  --  {name}: {e}");
            }
        }
    }
    let json = pack.to_json().map_err(|e| e.to_string())?;
    let tmp = out.with_extension("tmp");
    std::fs::write(&tmp, json).map_err(|e| format!("{}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, &out).map_err(|e| format!("{}: {e}", out.display()))?;
    println!(
        "\n{added} recordings added, {failed} failed. {} now has {} songs ({} recordings).",
        out.display(),
        pack.songs.len(),
        pack.recordings()
    );
    Ok(())
}

#[cfg(any(feature = "onnx", feature = "onnx-dynamic"))]
fn load_embedder(path: &Path) -> Result<Box<dyn rhema_songmatch::embedder::Embedder>, String> {
    let threads = std::thread::available_parallelism().map_or(4, std::num::NonZero::get);
    rhema_songmatch::embedder::OnnxEmbedder::load(path, threads)
        .map(|e| Box::new(e) as Box<dyn rhema_songmatch::embedder::Embedder>)
        .map_err(|e| e.to_string())
}

#[cfg(not(any(feature = "onnx", feature = "onnx-dynamic")))]
fn load_embedder(_path: &Path) -> Result<Box<dyn rhema_songmatch::embedder::Embedder>, String> {
    Err("built without the song model: use --features onnx (or onnx-dynamic on Intel Macs)".into())
}

/// "4:03" for 243 seconds.
#[expect(clippy::cast_possible_truncation, clippy::cast_sign_loss, reason = "song lengths in seconds")]
fn clock(seconds: f32) -> String {
    let s = seconds.max(0.0).round() as u32;
    format!("{}:{:02}", s / 60, s % 60)
}

#[expect(clippy::cast_precision_loss, reason = "sample counts")]
fn fingerprint(
    embedder: &dyn rhema_songmatch::embedder::Embedder,
    file: &Path,
    name: &str,
) -> Result<rhema_songmatch::pack::PackRecording, String> {
    let samples = audio::load(file)?;
    let seconds = samples.len() as f32 / audio::TARGET_RATE as f32;
    if seconds < MIN_SECONDS {
        return Err(format!("only {seconds:.0} s long"));
    }
    let embeddings = rhema_songmatch::embedder::embed_reference(embedder, &samples).map_err(|e| e.to_string())?;
    rhema_songmatch::pack::PackRecording::encode(name, seconds, &embeddings).map_err(|e| e.to_string())
}

fn list(path: &Path) -> Result<(), String> {
    let pack = SongPack::from_json(&std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?)
        .map_err(|e| e.to_string())?;
    println!("{} — model {}, {} songs, {} recordings", path.display(), pack.model, pack.songs.len(), pack.recordings());
    for song in &pack.songs {
        let minutes: f32 = song.recordings.iter().map(|r| r.seconds).sum::<f32>() / 60.0;
        println!(
            "  {}{}  ({} recordings, {minutes:.1} min)",
            song.title,
            song.artist.as_deref().map(|a| format!(" — {a}")).unwrap_or_default(),
            song.recordings.len()
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titles_come_from_file_names() {
        assert_eq!(title_from_file(Path::new("03 - No_One_Like_the_Lord.m4a")), "No One Like the Lord");
        assert_eq!(title_from_file(Path::new("/x/Silent Night.mp3")), "Silent Night");
        assert_eq!(title_from_file(Path::new("12. Holy Spirit.mp3")), "Holy Spirit");
        assert_eq!(title_from_file(Path::new("10000 Reasons.mp3")), "10000 Reasons", "a number in the title stays");
    }
}
