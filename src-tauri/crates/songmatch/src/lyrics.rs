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
    /// The church's own copy (imported or added), shown instead of a bundled
    /// hymnal's copy of the same song.
    pub preferred: bool,
}

/// Share of the shorter song's phrases two songs must share to be copies
/// of one song (the same hymn in two hymnals, an older export).
const SAME_SONG_SHARED: f32 = 0.6;
/// A preferred copy wins when it matches this nearly as well.
const PREFERRED_MARGIN: f32 = 0.1;

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

/// Where in a known song the singing is (for following it on screen).
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Position {
    /// Index into [`SongLyrics::stanzas`].
    pub stanza: usize,
    /// The line of that stanza most like the last words heard.
    pub line: usize,
    /// Lines in that stanza.
    pub lines: usize,
    /// Share of the recent words' weighted phrases found in the stanza.
    pub score: f32,
    /// Clear enough to move the slides.
    pub confident: bool,
}

/// Words needed before a position is reported.
const LOCATE_MIN_WORDS: usize = 4;
/// Score a stanza needs to be confident...
const LOCATE_SCORE: f32 = 0.3;
/// ...and its lead over the next different stanza.
const LOCATE_LEAD: f32 = 0.15;
/// The last few words decide the line (they are the line being sung now).
const LOCATE_TAIL_WORDS: usize = 6;

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

    /// Where in `song_id` the recent words are: which stanza, and which
    /// line of it. Only that song's stanzas compete, so a few words are
    /// enough. `None` when too little was heard or nothing matches.
    pub fn locate(&self, song_id: &str, recent: &str) -> Option<Position> {
        let song = self.songs.iter().find(|s| s.lyrics.song_id == song_id)?;
        let heard = words(recent);
        if heard.len() < LOCATE_MIN_WORDS {
            return None;
        }
        let query = grams(&heard);
        let total: f32 = query.iter().map(|g| self.weight(*g)).sum();
        if total <= 0.0 {
            return None;
        }
        let share = |set: &HashSet<Gram>| query.iter().filter(|g| set.contains(g)).map(|g| self.weight(*g)).sum::<f32>() / total;
        let mut scored: Vec<(usize, f32)> = song.stanza_grams.iter().map(share).enumerate().collect();
        scored.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
        let (stanza, score) = *scored.first().filter(|(_, s)| *s > 0.0)?;
        // A stanza repeated word for word (a chorus written out twice) is no rival.
        let rival = scored
            .iter()
            .skip(1)
            .find(|(k, _)| song.stanza_grams[*k] != song.stanza_grams[stanza])
            .map_or(0.0, |(_, s)| *s);
        let lines = &song.lyrics.stanzas[stanza];
        let tail = grams(&heard[heard.len().saturating_sub(LOCATE_TAIL_WORDS)..]);
        let line_score = |line: &String, q: &HashSet<Gram>| {
            grams(&words(line)).iter().filter(|g| q.contains(g)).map(|g| self.weight(*g)).sum::<f32>()
        };
        let best_line = |q: &HashSet<Gram>| {
            lines
                .iter()
                .enumerate()
                .map(|(i, l)| (i, line_score(l, q)))
                .filter(|(_, s)| *s > 0.0)
                // On a tie the later line: the singing moves forward.
                .max_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)))
                .map(|(i, _)| i)
        };
        let line = best_line(&tail).or_else(|| best_line(&query)).unwrap_or(0);
        Some(Position {
            stanza,
            line,
            lines: lines.len(),
            score,
            confident: score >= LOCATE_SCORE && score - rival >= LOCATE_LEAD,
        })
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
        // A few common words ("I need to see") are found in some song or
        // other: until a full stretch is heard, scores count for less.
        #[expect(clippy::cast_precision_loss, reason = "word counts are small")]
        let shortness = (query_words.len() as f32 / self.cfg.span_words.max(1) as f32).min(1.0);

        let mut scored: Vec<(usize, f32)> = self
            .songs
            .iter()
            .enumerate()
            .filter_map(|(i, s)| query.best_span(|g| s.grams.contains(&g), span_words).map(|score| (i, score * shortness)))
            .filter(|(_, score)| *score >= self.cfg.min_score)
            .collect();
        scored.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| self.songs[a.0].lyrics.title.cmp(&self.songs[b.0].lyrics.title)));
        let scored = self.one_per_song(scored);
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

impl LyricsIndex {
    /// Copies of one song count once (the best-scoring copy's score, the
    /// preferred copy shown), so two hymnals' copies neither show twice nor
    /// tie each other out of a confident lead. Keeps one past
    /// `max_results`, for the lead.
    fn one_per_song(&self, scored: Vec<(usize, f32)>) -> Vec<(usize, f32)> {
        let mut distinct: Vec<(usize, f32)> = Vec::new();
        for (i, score) in scored {
            if let Some(k) = distinct.iter().position(|&(j, _)| self.same_song(i, j)) {
                let (j, best) = distinct[k];
                if self.songs[i].lyrics.preferred && !self.songs[j].lyrics.preferred && score >= best - PREFERRED_MARGIN {
                    distinct[k] = (i, best);
                }
            } else if distinct.len() <= self.cfg.max_results {
                distinct.push((i, score));
            }
        }
        distinct
    }

    /// Whether two songs (by id) are copies of one song.
    pub fn are_copies(&self, a: &str, b: &str) -> bool {
        let find = |id: &str| self.songs.iter().position(|s| s.lyrics.song_id == id);
        match (find(a), find(b)) {
            (Some(a), Some(b)) => a == b || self.same_song(a, b),
            _ => false,
        }
    }

    fn same_song(&self, a: usize, b: usize) -> bool {
        let (a, b) = (&self.songs[a].grams, &self.songs[b].grams);
        let (small, large) = if a.len() <= b.len() { (a, b) } else { (b, a) };
        if small.is_empty() {
            return false;
        }
        let shared = small.iter().filter(|g| large.contains(g)).count();
        #[expect(clippy::cast_precision_loss, reason = "phrase counts are small")]
        let share = shared as f32 / small.len() as f32;
        share >= SAME_SONG_SHARED
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
            preferred: false,
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
    fn copies_of_one_song_show_once_and_still_lead() {
        let verse = &["Silent night, holy night", "All is calm, all is bright", "Round yon virgin mother and child"][..];
        let mut own = song("ew-silent-night", &[verse, &["Sleep in heavenly peace"]]);
        own.preferred = true;
        let index = LyricsIndex::new(
            vec![
                song("sda-silent-night", &[verse, &["Sleep in heavenly peace", "Sleep in heavenly peace"]]),
                own,
                song("amazing-grace", &[&["Amazing grace, how sweet the sound", "That saved a wretch like me"]]),
            ],
            LyricsConfig::default(),
        );
        let r = index.search("silent night holy night all is calm all is bright round yon virgin");
        assert_eq!(r.matches.iter().map(|m| m.song_id.as_str()).collect::<Vec<_>>(), ["ew-silent-night"], "{r:?}");
        assert!(r.confident, "copies no longer tie: {r:?}");
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
    fn locates_the_stanza_and_line_being_sung() {
        let lib = library();
        // Misheard as usual: "south" for "soul".
        let p = lib.locate("how-great-thou-art", "then sings my south my saviour god to thee").unwrap();
        assert_eq!((p.stanza, p.line, p.lines), (1, 0, 2));
        assert!(p.confident, "{p:?}");
        let p = lib.locate("how-great-thou-art", "to thee how great thou art how great thou art").unwrap();
        assert_eq!((p.stanza, p.line), (1, 1), "the last words decide the line");
        let p = lib.locate("how-great-thou-art", "o lord my god when i in awesome wonder").unwrap();
        assert_eq!(p.stanza, 0);
        assert!(lib.locate("how-great-thou-art", "thank you").is_none(), "too few words");
        assert!(lib.locate("no-such-song", "then sings my soul my saviour").is_none());
    }

    #[test]
    fn unrelated_words_are_not_a_confident_position() {
        let lib = library();
        let p = lib.locate("how-great-thou-art", "please be seated we will now read from the gospel");
        assert!(p.is_none_or(|p| !p.confident), "{p:?}");
    }

    #[test]
    fn a_few_common_words_do_not_look_certain() {
        // Four words, all in one song: found, but not as a strong match.
        let r = library().search("o god my father");
        assert!(r.matches[0].score <= 0.5 + 1e-6, "{r:?}");
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
