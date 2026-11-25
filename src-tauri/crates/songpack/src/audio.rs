//! Audio files to 16 kHz mono samples, as the song model expects.

use std::path::Path;

use rubato::{Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction};
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

pub const TARGET_RATE: u32 = 16_000;

/// File extensions read as audio.
pub const EXTENSIONS: [&str; 7] = ["mp3", "m4a", "aac", "mp4", "wav", "flac", "alac"];

/// Decode a whole audio file to mono samples; returns them and their rate.
pub fn decode_mono(path: &Path) -> Result<(Vec<f32>, u32), String> {
    let bytes = std::fs::read(path).map_err(|e| format!("cannot open: {e}"))?;
    let ext = path.extension().and_then(|e| e.to_str());
    match decode_bytes(bytes.clone(), ext) {
        Ok(out) => Ok(out),
        // Some MP3s carry an ID3 tag the reader trips over (an empty one,
        // for instance); the audio after it is fine.
        Err(first) => match id3_len(&bytes) {
            Some(skip) => decode_bytes(bytes[skip..].to_vec(), ext).map_err(|_| first),
            None => Err(first),
        },
    }
}

/// Length of a leading ID3v2 tag (header, size, optional footer).
fn id3_len(bytes: &[u8]) -> Option<usize> {
    if bytes.len() < 10 || &bytes[..3] != b"ID3" {
        return None;
    }
    // Four 7-bit bytes ("syncsafe").
    let size = bytes[6..10].iter().fold(0usize, |n, &b| (n << 7) | usize::from(b & 0x7F));
    let footer = if bytes[5] & 0x10 != 0 { 10 } else { 0 };
    Some((10 + size + footer).min(bytes.len()))
}

fn decode_bytes(bytes: Vec<u8>, ext: Option<&str>) -> Result<(Vec<f32>, u32), String> {
    let source = std::io::Cursor::new(bytes);
    let stream = MediaSourceStream::new(Box::new(source), symphonia::core::io::MediaSourceStreamOptions::default());
    let mut hint = Hint::new();
    if let Some(ext) = ext {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe()
        .format(&hint, stream, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|e| format!("not a readable audio file ({e})"))?;
    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or("no audio track")?;
    let track_id = track.id;
    let mut rate = track.codec_params.sample_rate.unwrap_or(0);
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("unsupported audio ({e})"))?;

    let mut out = Vec::new();
    let mut buffer: Option<SampleBuffer<f32>> = None;
    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(Error::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(Error::ResetRequired) => break,
            Err(e) => return Err(format!("read failed ({e})")),
        };
        if packet.track_id() != track_id {
            continue;
        }
        let frames = match decoder.decode(&packet) {
            Ok(d) => d,
            // A damaged frame: skip it, as players do.
            Err(Error::DecodeError(_)) => continue,
            Err(e) => return Err(format!("decode failed ({e})")),
        };
        let spec = *frames.spec();
        rate = spec.rate;
        let channels = spec.channels.count().max(1);
        let needed = frames.capacity() * channels;
        if buffer.as_ref().is_none_or(|b| b.capacity() < needed) {
            buffer = Some(SampleBuffer::new(frames.capacity() as u64, spec));
        }
        let Some(buf) = buffer.as_mut() else { continue };
        buf.copy_interleaved_ref(frames);
        #[expect(clippy::cast_precision_loss, reason = "a handful of channels")]
        let scale = 1.0 / channels as f32;
        out.extend(buf.samples().chunks(channels).map(|frame| frame.iter().sum::<f32>() * scale));
    }
    if rate == 0 {
        return Err("unknown sample rate".into());
    }
    Ok((out, rate))
}

/// Resample mono audio (high-quality sinc interpolation).
pub fn resample(input: &[f32], from: u32, to: u32) -> Result<Vec<f32>, String> {
    if from == to || input.is_empty() {
        return Ok(input.to_vec());
    }
    let ratio = f64::from(to) / f64::from(from);
    let params = SincInterpolationParameters {
        sinc_len: 128,
        f_cutoff: 0.95,
        interpolation: SincInterpolationType::Linear,
        oversampling_factor: 128,
        window: WindowFunction::BlackmanHarris2,
    };
    let chunk = 4096;
    let err = |e: &dyn std::fmt::Display| format!("resampling failed ({e})");
    let mut resampler = SincFixedIn::<f32>::new(ratio, 1.0, params, chunk, 1).map_err(|e| err(&e))?;
    let mut out = Vec::with_capacity(input.len() * usize::try_from(to).unwrap_or(1) / usize::try_from(from).unwrap_or(1).max(1) + chunk);
    let mut pos = 0;
    while pos + chunk <= input.len() {
        let block = resampler.process(&[&input[pos..pos + chunk]], None).map_err(|e| err(&e))?;
        out.extend_from_slice(&block[0]);
        pos += chunk;
    }
    if pos < input.len() {
        let block = resampler.process_partial(Some(&[&input[pos..]]), None).map_err(|e| err(&e))?;
        out.extend_from_slice(&block[0]);
    }
    // Flush what the filter still holds.
    let block = resampler.process_partial::<&[f32]>(None, None).map_err(|e| err(&e))?;
    out.extend_from_slice(&block[0]);
    #[expect(clippy::cast_possible_truncation, clippy::cast_sign_loss, clippy::cast_precision_loss, reason = "sample counts")]
    let expected = (input.len() as f64 * ratio).round() as usize;
    Ok(out.into_iter().skip(resampler.output_delay()).take(expected).collect())
}

/// A whole file as 16 kHz mono.
pub fn load(path: &Path) -> Result<Vec<f32>, String> {
    let (samples, rate) = decode_mono(path)?;
    resample(&samples, rate, TARGET_RATE)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn id3_tags_are_measured() {
        let mut empty_tag = b"ID3\x03\x00\x00\x00\x00\x00\x00".to_vec();
        empty_tag.extend_from_slice(&[0xFF, 0xFB]);
        assert_eq!(id3_len(&empty_tag), Some(10));
        // 0x01 0x00 in syncsafe = 128 bytes of tag.
        assert_eq!(id3_len(b"ID3\x04\x00\x00\x00\x00\x01\x00rest"), Some(14), "never past the end");
        assert_eq!(id3_len(b"\xFF\xFB\x90\x00 not a tag"), None);
    }

    #[test]
    #[expect(clippy::cast_possible_truncation, reason = "a test tone in f32")]
    fn resampling_keeps_length_and_pitch() {
        // One second of a 440 Hz tone at 44.1 kHz.
        let input: Vec<f32> = (0..44_100).map(|i| (f64::from(i) * 440.0 * std::f64::consts::TAU / 44_100.0).sin() as f32).collect();
        let out = resample(&input, 44_100, TARGET_RATE).unwrap();
        assert_eq!(out.len(), 16_000);
        // Count rising zero crossings in the middle: about 440 per second.
        let mid = &out[2_000..14_000];
        let crossings = mid.windows(2).filter(|w| w[0] < 0.0 && w[1] >= 0.0).count();
        assert!((325..=335).contains(&crossings), "{crossings} crossings in 0.75 s");
    }
}
