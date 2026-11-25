//! Lyrics matching on Manna's bundled hymnals (955 hymns, many sharing
//! phrases), with simulated recognition errors in the sung words.

use std::path::PathBuf;

use rhema_songmatch::lyrics::{words, LyricsConfig, LyricsIndex, SongLyrics};
use serde_json::Value;

fn hymnals() -> Vec<SongLyrics> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../hymnals");
    let mut out = Vec::new();
    for name in ["ghs", "sda"] {
        let data: Value = serde_json::from_str(&std::fs::read_to_string(dir.join(format!("{name}.json"))).unwrap()).unwrap();
        for h in data["hymns"].as_array().unwrap() {
            let lines = |v: &Value| v.as_array().map(|l| l.iter().filter_map(|x| x.as_str().map(String::from)).collect::<Vec<_>>());
            let mut stanzas: Vec<Vec<String>> = h["stanzas"].as_array().unwrap().iter().filter_map(lines).collect();
            if let Some(chorus) = lines(&h["chorus"]).filter(|c| !c.is_empty()) {
                stanzas.push(chorus);
            }
            out.push(SongLyrics {
                song_id: format!("{name}-{}", h["number"]),
                title: h["title"].as_str().unwrap_or_default().to_string(),
                stanzas,
                preferred: false,
            });
        }
    }
    out
}

/// Small deterministic generator (no test dependency needed).
struct Lcg(u64);

impl Lcg {
    fn next(&mut self, n: usize) -> usize {
        self.0 = self.0.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1_442_695_040_888_963_407);
        usize::try_from(self.0 >> 33).unwrap() % n.max(1)
    }
}

/// Two consecutive lines with a share of words misheard (replaced by a
/// random library word) or missed.
fn sung(song: &SongLyrics, rng: &mut Lcg, vocab: &[String], error_pct: usize) -> Option<String> {
    let stanza = &song.stanzas[rng.next(song.stanzas.len())];
    if stanza.len() < 2 {
        return None;
    }
    let start = rng.next(stanza.len() - 1);
    let mut out = Vec::new();
    for w in words(&format!("{} {}", stanza[start], stanza[start + 1])) {
        match rng.next(100) {
            r if r < error_pct / 2 => {}
            r if r < error_pct => out.push(vocab[rng.next(vocab.len())].clone()),
            _ => out.push(w),
        }
    }
    Some(out.join(" "))
}

#[test]
fn hymnal_lyrics_survive_recognition_errors() {
    let songs = hymnals();
    let idx = LyricsIndex::new(songs.clone(), LyricsConfig::default());
    let mut vocab: Vec<String> = songs.iter().flat_map(|s| s.stanzas.iter().flatten().flat_map(|l| words(l))).collect();
    vocab.sort();
    vocab.dedup();

    let mut rng = Lcg(7);
    for error_pct in [0, 20, 35] {
        let (mut n, mut top1, mut top3, mut confident_right, mut confident_wrong) = (0, 0, 0, 0, 0);
        for _ in 0..400 {
            let song = &songs[rng.next(songs.len())];
            let Some(text) = sung(song, &mut rng, &vocab, error_pct) else { continue };
            n += 1;
            let r = idx.search(&text);
            // The same hymn from the other hymnal is the right answer too.
            let rank = r.matches.iter().position(|m| idx.are_copies(&m.song_id, &song.song_id));
            if r.confident && rank != Some(0) && std::env::var_os("SHOW_WRONG").is_some() {
                println!("  WRONG: sang {:?} [{}], got {:?} [{}]: {text}", song.title, song.song_id, r.matches[0].title, r.matches[0].song_id);
            }
            top1 += i32::from(rank == Some(0));
            top3 += i32::from(rank.is_some());
            if r.confident {
                if rank == Some(0) { confident_right += 1 } else { confident_wrong += 1 }
            }
        }
        let pct = |k: i32| f64::from(k) * 100.0 / f64::from(n);
        println!(
            "{error_pct}% words wrong ({n} tries): top-1 {:.0}%, top-3 {:.0}%, auto-present right {:.0}%, wrong {:.1}%",
            pct(top1), pct(top3), pct(confident_right), pct(confident_wrong)
        );
        assert!(pct(confident_wrong) <= 2.0, "too many confident wrong songs at {error_pct}% errors");
        if error_pct <= 20 {
            assert!(pct(top3) >= 85.0, "too few songs found at {error_pct}% errors");
        }
    }

    // Preaching should not look like a song.
    let speech = [
        "good morning church please turn with me to the book of romans chapter eight",
        "today we are going to talk about faith and how it changes the way we live",
        "let us bow our heads as we pray for the families in our congregation this week",
        "the offering baskets will be passed around now please give cheerfully",
        "when Paul wrote to the Philippians he was in prison but he was full of joy",
    ];
    for s in speech {
        assert!(!idx.search(s).confident, "speech taken for a song: {s}");
    }
}
