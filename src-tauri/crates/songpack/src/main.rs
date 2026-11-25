//! `manna-songpack`: turn recordings of whole songs into a song pack that
//! any Manna install can import (Songs panel, "Import song pack").
//!
//! ```text
//! manna-songpack build <audio files or folders>... --out church.mannasongs
//!                      [--stems] [--titles titles.csv] [--model clews_int8.onnx]
//! manna-songpack list church.mannasongs
//! ```
//!
//! `--stems` also splits each song into vocals, bass and guitars & keys
//! (Demucs) and keeps a reference for each, so a song is recognised from
//! a leader singing alone or a lone instrument, not only the full band.
//!
//! Each file is one song; its title is the file name ("No One Like the
//! Lord.m4a"), leading track numbers and underscores aside, or a line of
//! `--titles` (`file name,title[,artist]`). Building into an existing pack
//! adds to it, so a library can grow a few songs at a time.

mod audio;
mod stems;

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use rhema_songmatch::pack::{SongPack, PACK_EXTENSION};

/// Must match the app's model id: other models' packs are refused there.
const MODEL_ID: &str = "clews-dvi-int8-v1";
const MODEL_RELATIVE: &str = "models/songmatch/clews_int8.onnx";
/// Shorter recordings say too little about a song.
const MIN_SECONDS: f32 = 10.0;
/// A window this much quieter than the part's typical loudness (a bass
/// before it comes in, vocals in an instrumental) is left out: silence
/// would "match" any quiet room.
const QUIET_SHARE: f32 = 0.15;
/// Below this a window is silent whatever the recording level.
const SILENT_RMS: f32 = 0.002;

fn usage() -> ExitCode {
    eprintln!(
        "usage:\n  manna-songpack build <audio files or folders>... --out FILE.{PACK_EXTENSION} [--stems] [--titles titles.csv] [--model clews_int8.onnx]\n                       [--demucs-python PATH] [--demucs-device cpu|mps|cuda]\n  manna-songpack list FILE.{PACK_EXTENSION}"
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
    let (mut split, mut demucs_python, mut demucs_device) = (false, None, None);
    let mut it = args.iter();
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--out" => out = it.next().map(PathBuf::from),
            "--titles" => titles = it.next().map(PathBuf::from),
            "--model" => model = it.next().map(PathBuf::from),
            "--stems" => split = true,
            "--demucs-python" => demucs_python = it.next().map(PathBuf::from),
            "--demucs-device" => demucs_device = it.next().cloned(),
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
    let separator = split.then(|| stems::Separator::find(demucs_python, demucs_device)).transpose()?;
    let embedder = load_embedder(&model_path(model)?)?;

    let (mut added, mut failed) = (0, 0);
    for file in &files {
        let name = file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let (title, artist) = titles
            .iter()
            .find(|(f, ..)| f.eq_ignore_ascii_case(&name))
            .map_or_else(|| (title_from_file(file), None), |(_, t, a)| (t.clone(), a.clone()));
        let started = std::time::Instant::now();
        match fingerprint_file(embedder.as_ref(), separator.as_ref(), file, &name) {
            Ok(recordings) => {
                let parts: Vec<String> = recordings
                    .iter()
                    .map(|r| r.part.as_deref().map_or_else(|| "mix".to_string(), |p| stems::part_label(p).to_string()))
                    .collect();
                let seconds = recordings.first().map_or(0.0, |r| r.seconds);
                let windows: usize = recordings.iter().map(|r| r.windows).sum();
                for recording in recordings {
                    pack.add(&title, artist.as_deref(), recording);
                }
                added += 1;
                println!(
                    "  ok  {title}  ({}, {}, {windows} windows, {:.0} s)",
                    clock(seconds),
                    parts.join(" + "),
                    started.elapsed().as_secs_f32()
                );
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
fn rms(samples: &[f32]) -> f32 {
    (samples.iter().map(|x| x * x).sum::<f32>() / samples.len().max(1) as f32).sqrt()
}

/// Reference embeddings of 16 kHz audio (20 s windows every 10 s), leaving
/// out windows that are quiet for this recording. `None` if all are.
fn reference(embedder: &dyn rhema_songmatch::embedder::Embedder, samples: &[f32]) -> Result<Option<Vec<Vec<f32>>>, String> {
    let windows = rhema_songmatch::embedder::windows(samples, 20.0, 10.0);
    let levels: Vec<f32> = windows.iter().map(|w| rms(w)).collect();
    let mut sorted = levels.clone();
    sorted.sort_by(f32::total_cmp);
    let typical = sorted.get(sorted.len() * 9 / 10).copied().unwrap_or(0.0);
    let floor = (typical * QUIET_SHARE).max(SILENT_RMS);
    let kept: Vec<Vec<f32>> = windows.into_iter().zip(levels).filter(|(_, l)| *l >= floor).map(|(w, _)| w).collect();
    if kept.is_empty() {
        return Ok(None);
    }
    let mut out = Vec::with_capacity(kept.len());
    for batch in kept.chunks(8) {
        out.extend(embedder.embed_windows(batch).map_err(|e| e.to_string())?);
    }
    Ok(Some(out))
}

/// The pack recordings for one song file: the full mix, and with a
/// separator its parts too.
#[expect(clippy::cast_precision_loss, reason = "sample counts")]
fn fingerprint_file(
    embedder: &dyn rhema_songmatch::embedder::Embedder,
    separator: Option<&stems::Separator>,
    file: &Path,
    name: &str,
) -> Result<Vec<rhema_songmatch::pack::PackRecording>, String> {
    let (decoded, rate) = audio::decode_mono(file)?;
    let mix = audio::resample(&decoded, rate, audio::TARGET_RATE)?;
    let seconds = mix.len() as f32 / audio::TARGET_RATE as f32;
    if seconds < MIN_SECONDS {
        return Err(format!("only {seconds:.0} s long"));
    }
    let encode = |label: &str, embeddings: &[Vec<f32>]| {
        rhema_songmatch::pack::PackRecording::encode(label, seconds, embeddings).map_err(|e| e.to_string())
    };
    let mut out = Vec::new();
    if let Some(embeddings) = reference(embedder, &mix)? {
        out.push(encode(name, &embeddings)?);
    }
    if let Some(separator) = separator {
        for (part, audio_part, part_rate) in separator.split(&decoded, rate)? {
            let part16 = audio::resample(&audio_part, part_rate, audio::TARGET_RATE)?;
            if let Some(embeddings) = reference(embedder, &part16)? {
                let mut recording = encode(&format!("{name} ({part})"), &embeddings)?;
                recording.part = Some(part.to_string());
                out.push(recording);
            }
        }
    }
    if out.is_empty() {
        return Err("silent".into());
    }
    Ok(out)
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
    fn quiet_stretches_are_left_out_of_references() {
        struct Count;
        impl rhema_songmatch::embedder::Embedder for Count {
            fn embed_windows(&self, w: &[Vec<f32>]) -> rhema_songmatch::Result<Vec<Vec<f32>>> {
                Ok(w.iter().map(|_| vec![1.0]).collect())
            }
        }
        // 30 s silent, then 60 s playing: windows start every 10 s.
        let mut audio = vec![0.0001; 30 * 16_000];
        audio.extend((0..60 * 16_000).map(|i| if i % 2 == 0 { 0.2 } else { -0.2 }));
        let kept = reference(&Count, &audio).unwrap().unwrap();
        assert_eq!(kept.len(), 6, "of 8 windows, those starting at 0 and 10 s are silent");
        assert!(reference(&Count, &vec![0.0; 40 * 16_000]).unwrap().is_none());
    }

    #[test]
    fn titles_come_from_file_names() {
        assert_eq!(title_from_file(Path::new("03 - No_One_Like_the_Lord.m4a")), "No One Like the Lord");
        assert_eq!(title_from_file(Path::new("/x/Silent Night.mp3")), "Silent Night");
        assert_eq!(title_from_file(Path::new("12. Holy Spirit.mp3")), "Holy Spirit");
        assert_eq!(title_from_file(Path::new("10000 Reasons.mp3")), "10000 Reasons", "a number in the title stays");
    }
}
