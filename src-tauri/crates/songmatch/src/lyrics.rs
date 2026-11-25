//! Song detection from the words being sung.
//!
//! The live transcript (the same speech recognition that finds Bible
//! verses) is compared with the lyrics of every song in Manna. This needs
//! no recordings, so every imported song can be found from day one; the
//! sound matcher ([`crate::listener`]) adds songs with recordings, music
//! without clear words, and the first seconds before anyone sings.
//!
//! Matching uses word pairs and triples, weighted by how rare they are
//! across the library: "amazing grace how sweet" says far more than "the
//! lord". Recognition of singing is noisy, so a song's score is the share
//! of the transcript's weighted phrases found in it (0 to 1), and the best
//! stanza is reported so the operator lands on the verse being sung.
//!
//! The transcript window mixes singing with whatever was said around it
//! ("let's stand and sing..."), so each song is scored on its best stretch
//! of the window (at least [`LyricsConfig::span_words`] words): talk before
//! or after the singing no longer drags the score down.

use std::collections::{HashMap, HashSet};

use serde::Serialize;

/// One song's lyrics, stanza by stanza (in presentation order).
#[derive(Debug, Clone, PartialEq)]
pub struct SongLyrics {
    pub song_id: String,
    pub title: String,
    pub stanzas: Vec<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsMatch {
    pub song_id: String,
    pub title: String,
    /// Share of the transcript's weighted phrases found in the song (0 to 1).
    pub score: f32,
    /// Best-matching stanza (index into [`SongLyrics::stanzas`]).
    pub stanza: usize,
    /// The line of that stanza most like the transcript.
    pub line: String,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LyricsConfig {
    /// Fewer transcript words than this give no matches.
    pub min_words: usize,
    /// Shortest stretch of the transcript a song is scored on.
    pub span_words: usize,
    /// Least score worth suggesting.
    pub min_score: f32,
    /// Transcript words needed before any match is confident.
    pub confident_min_words: usize,
    /// Score needed to call a song confidently...
    pub confident_score: f32,
    /// ...and its lead over the runner-up.
    pub confident_lead: f32,
    pub max_results: usize,
}

impl Default for LyricsConfig {
    fn default() -> Self {
        Self { min_words: 4, span_words: 8, min_score: 0.2, confident_min_words: 8, confident_score: 0.45, confident_lead: 0.2, max_results: 3 }
    }
}

type Gram = u64;

fn hash_words(words: &[String]) -> Gram {
    // FNV-1a over the words, with a separator so "ab c" != "a bc".
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for w in words {
        for b in w.bytes().chain(std::iter::once(b' ')) {
            h ^= u64::from(b);
            h = h.wrapping_mul(0x0100_0000_01b3);
        }
    }
    h
}

/// Lowercase words without punctuation; "don't" becomes "dont". A plural
/// or third-person "s" is dropped from longer words, since recognition of
/// sung words often gets it wrong.
pub fn words(text: &str) -> Vec<String> {
    text.split(|c: char| c.is_whitespace() || c == '-' || c == '—' || c == '/')
        .map(|w| w.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect::<String>())
        .filter(|w| !w.is_empty())
        .map(|w| if w.len() > 4 && w.ends_with('s') && !w.ends_with("ss") { w[..w.len() - 1].to_string() } else { w })
        .collect()
}

fn grams(words: &[String]) -> HashSet<Gram> {
    let mut out = HashSet::new();
    for n in [2, 3] {
        for w in words.windows(n) {
            out.insert(hash_words(w));
        }
    }
    out
}

struct IndexedSong {
    lyrics: SongLyrics,
    grams: HashSet<Gram>,
    stanza_grams: Vec<HashSet<Gram>>,
}

#[derive(Default)]
pub struct LyricsIndex {
    songs: Vec<IndexedSong>,
    /// Inverse document frequency of each phrase.
    idf: HashMap<Gram, f32>,
    cfg: LyricsConfig,
}

/// The transcript's best matches, and whether the top one is confident.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsResult {
    pub matches: Vec<LyricsMatch>,
    pub confident: bool,
}

impl LyricsIndex {
    pub fn new(songs: Vec<SongLyrics>, cfg: LyricsConfig) -> Self {
        let songs: Vec<IndexedSong> = songs
            .into_iter()
            .map(|lyrics| {
                let stanza_grams: Vec<HashSet<Gram>> =
                    lyrics.stanzas.iter().map(|s| grams(&words(&s.join(" ")))).collect();
                // Phrases across stanza boundaries count too (choruses run on).
                let all = grams(&words(&lyrics.stanzas.iter().flatten().cloned().collect::<Vec<_>>().join(" ")));
                IndexedSong { lyrics, grams: all, stanza_grams }
            })
            .collect();
        let mut df: HashMap<Gram, u32> = HashMap::new();
        for s in &songs {
            for g in &s.grams {
                *df.entry(*g).or_default() += 1;
            }
        }
        #[expect(clippy::cast_precision_loss, reason = "song counts are small")]
        let n = songs.len().max(1) as f32;
        #[expect(clippy::cast_precision_loss, reason = "song counts are small")]
        let idf = df.into_iter().map(|(g, d)| (g, (1.0 + n / d as f32).ln())).collect();
        Self { songs, idf, cfg }
    }

    pub fn len(&self) -> usize {
        self.songs.len()
    }

    pub fn is_empty(&self) -> bool {
        self.songs.is_empty()
    }

    /// Weight of a transcript phrase; one in no song still counts against
    /// every song (it is evidence of *something* else being sung).
    fn weight(&self, g: Gram) -> f32 {
        #[expect(clippy::cast_precision_loss, reason = "song counts are small")]
        let unseen = (1.0 + self.songs.len().max(1) as f32).ln();
        self.idf.get(&g).copied().unwrap_or(unseen)
    }

    /// Match recent transcript text (the last sentence or two).
    pub fn search(&self, transcript: &str) -> LyricsResult {
        let none = LyricsResult { matches: Vec::new(), confident: false };
        let query_words = words(transcript);
        if query_words.len() < self.cfg.min_words {
            return none;
        }
        let query = Query::new(&query_words, |g| self.weight(g));
        let span_words = self.cfg.span_words.min(query_words.len());

        let mut scored: Vec<(usize, f32)> = self
            .songs
            .iter()
            .enumerate()
            .filter_map(|(i, s)| query.best_span(|g| s.grams.contains(&g), span_words).map(|score| (i, score)))
            .filter(|(_, score)| *score >= self.cfg.min_score)
            .collect();
        scored.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| self.songs[a.0].lyrics.title.cmp(&self.songs[b.0].lyrics.title)));
        let enough = query_words.len() >= self.cfg.confident_min_words;
        let confident = enough && match scored.as_slice() {
            [] => false,
            [(_, best)] => *best >= self.cfg.confident_score,
            [(_, best), (_, second), ..] => {
                *best >= self.cfg.confident_score && best - second >= self.cfg.confident_lead
            }
        };
        let matches = scored
            .into_iter()
            .take(self.cfg.max_results)
            .map(|(i, score)| {
                let song = &self.songs[i];
                // Stanza and line from everything heard (talk matches no line).
                let heard = query.all_grams();
                let score_of = |set: &HashSet<Gram>| heard.iter().filter(|g| set.contains(g)).map(|g| self.weight(*g)).sum::<f32>();
                let stanza = song
                    .stanza_grams
                    .iter()
                    .enumerate()
                    .max_by(|a, b| score_of(a.1).total_cmp(&score_of(b.1)).then(b.0.cmp(&a.0)))
                    .map_or(0, |(k, _)| k);
                let line = song.lyrics.stanzas.get(stanza).and_then(|lines| best_line(lines, &heard, &|g| self.weight(g))).unwrap_or_default();
                LyricsMatch { song_id: song.lyrics.song_id.clone(), title: song.lyrics.title.clone(), score, stanza, line }
            })
            .collect();
        LyricsResult { matches, confident }
    }
}

/// The transcript's phrases by position, for scoring stretches of it.
struct Query {
    n_words: usize,
    /// (start word, length 2 or 3, phrase, weight)
    grams: Vec<(usize, usize, Gram, f32)>,
}

impl Query {
    fn new(words: &[String], weight: impl Fn(Gram) -> f32) -> Self {
        let mut grams = Vec::new();
        for n in [2, 3] {
            for (start, w) in words.windows(n).enumerate() {
                let g = hash_words(w);
                grams.push((start, n, g, weight(g)));
            }
        }
        Self { n_words: words.len(), grams }
    }

    fn all_grams(&self) -> HashSet<Gram> {
        self.grams.iter().map(|(_, _, g, _)| *g).collect()
    }

    /// The song's score on its best stretch of at least `min_words` words:
    /// the largest share of weight its phrases make up, or `None` if none match.
    fn best_span(&self, song_has: impl Fn(Gram) -> bool, min_words: usize) -> Option<f32> {
        // Prefix sums of weight (all, and found in the song) by start word,
        // separately for pairs and triples: a stretch from..to holds the
        // pairs starting in from..=to-2 and the triples in from..=to-3.
        let w = self.n_words;
        let mut total = [vec![0.0_f32; w + 1], vec![0.0_f32; w + 1]];
        let mut found = [vec![0.0_f32; w + 1], vec![0.0_f32; w + 1]];
        let mut any = false;
        for &(start, n, g, weight) in &self.grams {
            total[n - 2][start + 1] += weight;
            if song_has(g) {
                found[n - 2][start + 1] += weight;
                any = true;
            }
        }
        if !any {
            return None;
        }
        for k in 0..2 {
            for i in 1..=w {
                total[k][i] += total[k][i - 1];
                found[k][i] += found[k][i - 1];
            }
        }
        let sum = |p: &[f32], from: usize, to: usize, n: usize| if to >= from + n { p[to - n + 1] - p[from] } else { 0.0 };
        let mut best: Option<f32> = None;
        for from in 0..w {
            for to in (from + min_words.max(2))..=w {
                let t = sum(&total[0], from, to, 2) + sum(&total[1], from, to, 3);
                if t <= 0.0 {
                    continue;
                }
                let score = (sum(&found[0], from, to, 2) + sum(&found[1], from, to, 3)) / t;
                if best.is_none_or(|b| score > b) {
                    best = Some(score);
                }
            }
        }
        best
    }
}

fn best_line(lines: &[String], query: &HashSet<Gram>, weight: &dyn Fn(Gram) -> f32) -> Option<String> {
    lines
        .iter()
        .map(|l| (l, grams(&words(l)).iter().filter(|g| query.contains(g)).map(|g| weight(*g)).sum::<f32>()))
        .max_by(|a, b| a.1.total_cmp(&b.1))
        .filter(|(_, s)| *s > 0.0)
        .map(|(l, _)| l.clone())
}

/// Keeps the last few transcript segments to match against.
#[derive(Debug, Default)]
pub struct TranscriptWindow {
    segments: std::collections::VecDeque<String>,
    max_words: usize,
}

impl TranscriptWindow {
    pub fn new(max_words: usize) -> Self {
        Self { segments: std::collections::VecDeque::new(), max_words }
    }

    /// Add a final transcript segment; returns the window's text.
    pub fn push(&mut self, segment: &str) -> String {
        self.segments.push_back(segment.trim().to_string());
        while self.segments.len() > 1 && self.word_count() - words(&self.segments[0]).len() >= self.max_words {
            self.segments.pop_front();
        }
        self.text()
    }

    fn word_count(&self) -> usize {
        self.segments.iter().map(|s| words(s).len()).sum()
    }

    pub fn text(&self) -> String {
        self.segments.iter().map(String::as_str).collect::<Vec<_>>().join(" ")
    }

    pub fn clear(&mut self) {
        self.segments.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn song(id: &str, stanzas: &[&[&str]]) -> SongLyrics {
        SongLyrics {
            song_id: id.into(),
            title: id.replace('-', " "),
            stanzas: stanzas.iter().map(|s| s.iter().map(|l| (*l).to_string()).collect()).collect(),
        }
    }

    fn library() -> LyricsIndex {
        LyricsIndex::new(
            vec![
                song("amazing-grace", &[
                    &["Amazing grace, how sweet the sound", "That saved a wretch like me"],
                    &["'Twas grace that taught my heart to fear", "And grace my fears relieved"],
                ]),
                song("how-great-thou-art", &[
                    &["O Lord my God, when I in awesome wonder", "Consider all the worlds Thy hands have made"],
                    &["Then sings my soul, my Saviour God, to Thee", "How great Thou art, how great Thou art"],
                ]),
                song("great-is-thy-faithfulness", &[
                    &["Great is Thy faithfulness, O God my Father", "There is no shadow of turning with Thee"],
                    &["Great is Thy faithfulness! Great is Thy faithfulness!", "Morning by morning new mercies I see"],
                ]),
                song("blessed-assurance", &[&["Blessed assurance, Jesus is mine", "O what a foretaste of glory divine"]]),
            ],
            LyricsConfig::default(),
        )
    }

    #[test]
    fn words_are_normalised() {
        assert_eq!(words("'Twas GRACE—that taught, my heart's fears"), ["twas", "grace", "that", "taught", "my", "heart", "fear"]);
    }

    #[test]
    fn finds_the_song_and_stanza_from_noisy_singing() {
        // Recognition errors: "south" for "soul", "savior" spelling, missing words.
        let r = library().search("then sings my south my savior god to thee how great thou art");
        assert!(r.confident, "{r:?}");
        assert_eq!(r.matches[0].song_id, "how-great-thou-art");
        assert_eq!(r.matches[0].stanza, 1);
        assert_eq!(r.matches[0].line, "Then sings my soul, my Saviour God, to Thee");
    }

    #[test]
    fn a_short_phrase_is_only_a_suggestion() {
        let r = library().search("oh god my father");
        assert_eq!(r.matches[0].song_id, "great-is-thy-faithfulness");
        assert!(!r.confident, "four words never auto-present");
    }

    #[test]
    fn speech_matches_nothing() {
        let r = library().search("please turn with me to the book of romans chapter eight");
        assert!(r.matches.is_empty(), "{r:?}");
    }

    #[test]
    fn talk_around_the_singing_does_not_lower_the_score() {
        let sung = "then sings my soul my saviour god to thee how great thou art";
        let alone = library().search(sung);
        let with_talk = library().search(&format!("okay everyone please stand up thank you {sung} that was lovely okay"));
        assert_eq!(with_talk.matches[0].song_id, "how-great-thou-art");
        assert!(with_talk.matches[0].score >= alone.matches[0].score - 1e-4, "{with_talk:?} vs {alone:?}");
        assert!(with_talk.confident, "{with_talk:?}");
        assert_eq!(with_talk.matches[0].line, "Then sings my soul, my Saviour God, to Thee");
    }

    #[test]
    fn short_fragments_wait_for_more_words() {
        assert!(library().search("amazing grace").matches.is_empty());
    }

    #[test]
    fn transcript_window_keeps_recent_words() {
        let mut w = TranscriptWindow::new(3);
        w.push("one two three four");
        w.push("five six seven");
        assert_eq!(w.text(), "five six seven", "oldest segment dropped while 3+ words remain without it");
        let mut w = TranscriptWindow::new(10);
        w.push("one two three");
        assert_eq!(w.push("four five"), "one two three four five");
    }
}
