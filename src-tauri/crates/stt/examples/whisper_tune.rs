//! Compare Whisper audio-context settings on clips of a recording.
//! Usage: `whisper_tune MODEL AUDIO.f32 THREADS START:DUR [START:DUR ...]` (whole seconds).
use std::{error::Error, fs, time::Instant};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<_> = std::env::args().collect();
    let bytes = fs::read(&args[2])?;
    let audio: Vec<f32> = bytes.as_chunks::<4>().0.iter().map(|b| f32::from_le_bytes(*b)).collect();
    let threads: i32 = args[3].parse()?;
    let context = WhisperContext::new_with_params(&args[1], WhisperContextParameters::default())?;
    let mut state = context.create_state()?;
    let variants: [(&str, Option<usize>, bool); 4] =
        [("full", None, true), ("m128", Some(128), true), ("m128-nofb", Some(128), false), ("m256-nofb", Some(256), false)];
    for spec in &args[4..] {
        let (start, dur) = spec.split_once(':').ok_or("START:DUR")?;
        let (start, dur): (usize, usize) = (start.parse()?, dur.parse()?);
        let clip = &audio[start * 16_000..(start + dur) * 16_000];
        for (label, margin, fallback) in variants {
            let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
            params.set_language(Some("en"));
            params.set_n_threads(threads);
            params.set_print_progress(false);
            params.set_print_special(false);
            params.set_print_realtime(false);
            params.set_token_timestamps(true);
            params.set_no_speech_thold(0.4);
            params.set_suppress_blank(true);
            params.set_suppress_non_speech_tokens(true);
            if let Some(m) = margin {
                params.set_audio_ctx(i32::try_from((clip.len().div_ceil(320) + m).min(1500))?);
            }
            if !fallback {
                params.set_temperature_inc(0.0);
            }
            let t = Instant::now();
            state.full(params, clip)?;
            let ms = t.elapsed().as_millis();
            let mut text = String::new();
            for s in 0..state.full_n_segments()? {
                text.push_str(&state.full_get_segment_text(s)?);
            }
            println!("{start:>5}+{dur:<3} {label:<10} {ms:>6} ms  {}", text.trim());
        }
    }
    Ok(())
}
