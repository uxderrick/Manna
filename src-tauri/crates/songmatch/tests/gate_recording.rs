//! Run the singing gate over a real recording (local only; needs the model
//! and ONNX Runtime). Prints the stretches it lets through.
//!
//! `ORT_DYLIB_PATH=... cargo test -p rhema-songmatch --features onnx-dynamic \
//!  --test gate_recording -- --ignored --nocapture`
//! with `MANNA_GATE_AUDIO` (raw f32 LE, 16 kHz mono) and `MANNA_YAMNET`.
#![cfg(feature = "onnx-core")]

use rhema_songmatch::gate::{GateConfig, SingingGate, YamnetClassifier, HOP_SAMPLES};

#[test]
#[ignore = "needs a local recording, the YAMNet model and ONNX Runtime"]
#[expect(clippy::cast_precision_loss, reason = "hop counts are small")]
fn gate_on_a_recording() {
    let audio = std::fs::read(std::env::var("MANNA_GATE_AUDIO").expect("MANNA_GATE_AUDIO")).unwrap();
    let samples: Vec<i16> = audio
        .as_chunks::<4>()
        .0
        .iter()
        .map(|b| {
            #[expect(clippy::cast_possible_truncation, reason = "clamped to the i16 range")]
            let s = (f32::from_le_bytes(*b) * 32_767.0).clamp(-32_768.0, 32_767.0) as i16;
            s
        })
        .collect();
    let model = std::env::var("MANNA_YAMNET").expect("MANNA_YAMNET");
    let mut gate = SingingGate::new(Box::new(YamnetClassifier::load(model.as_ref()).unwrap()), GateConfig::default());
    let started = std::time::Instant::now();
    let mut passed = Vec::new();
    for chunk in samples.chunks(171) {
        let out = gate.push(chunk);
        passed.extend(out.chunks(HOP_SAMPLES).map(|h| h.iter().any(|&s| s != 0)));
    }
    let hop_s = HOP_SAMPLES as f32 / 16_000.0;
    let mut start = None;
    for (i, &p) in passed.iter().chain(std::iter::once(&false)).enumerate() {
        match (p, start) {
            (true, None) => start = Some(i),
            (false, Some(s)) => {
                println!("{:>6.1}s - {:>6.1}s", s as f32 * hop_s, i as f32 * hop_s);
                start = None;
            }
            _ => {}
        }
    }
    let open = passed.iter().filter(|&&p| p).count();
    println!(
        "open {:.0}% of {:.0}s; {:.1}s to process",
        100.0 * open as f32 / passed.len() as f32,
        passed.len() as f32 * hop_s,
        started.elapsed().as_secs_f32()
    );
}
