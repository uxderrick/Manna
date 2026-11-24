//! The 66-book Protestant canon with the English names and abbreviations used
//! by the bundled Bible database (`data/build-bible-db.ts`).

/// `(abbreviation, English name)` by book number − 1. Abbreviations are the
/// OSIS book ids, which is also what the bundled database stores.
const CANON: [(&str, &str); 66] = [
    ("Gen", "Genesis"),
    ("Exod", "Exodus"),
    ("Lev", "Leviticus"),
    ("Num", "Numbers"),
    ("Deut", "Deuteronomy"),
    ("Josh", "Joshua"),
    ("Judg", "Judges"),
    ("Ruth", "Ruth"),
    ("1Sam", "1 Samuel"),
    ("2Sam", "2 Samuel"),
    ("1Kgs", "1 Kings"),
    ("2Kgs", "2 Kings"),
    ("1Chr", "1 Chronicles"),
    ("2Chr", "2 Chronicles"),
    ("Ezra", "Ezra"),
    ("Neh", "Nehemiah"),
    ("Esth", "Esther"),
    ("Job", "Job"),
    ("Ps", "Psalms"),
    ("Prov", "Proverbs"),
    ("Eccl", "Ecclesiastes"),
    ("Song", "Song of Solomon"),
    ("Isa", "Isaiah"),
    ("Jer", "Jeremiah"),
    ("Lam", "Lamentations"),
    ("Ezek", "Ezekiel"),
    ("Dan", "Daniel"),
    ("Hos", "Hosea"),
    ("Joel", "Joel"),
    ("Amos", "Amos"),
    ("Obad", "Obadiah"),
    ("Jonah", "Jonah"),
    ("Mic", "Micah"),
    ("Nah", "Nahum"),
    ("Hab", "Habakkuk"),
    ("Zeph", "Zephaniah"),
    ("Hag", "Haggai"),
    ("Zech", "Zechariah"),
    ("Mal", "Malachi"),
    ("Matt", "Matthew"),
    ("Mark", "Mark"),
    ("Luke", "Luke"),
    ("John", "John"),
    ("Acts", "Acts"),
    ("Rom", "Romans"),
    ("1Cor", "1 Corinthians"),
    ("2Cor", "2 Corinthians"),
    ("Gal", "Galatians"),
    ("Eph", "Ephesians"),
    ("Phil", "Philippians"),
    ("Col", "Colossians"),
    ("1Thess", "1 Thessalonians"),
    ("2Thess", "2 Thessalonians"),
    ("1Tim", "1 Timothy"),
    ("2Tim", "2 Timothy"),
    ("Titus", "Titus"),
    ("Phlm", "Philemon"),
    ("Heb", "Hebrews"),
    ("Jas", "James"),
    ("1Pet", "1 Peter"),
    ("2Pet", "2 Peter"),
    ("1John", "1 John"),
    ("2John", "2 John"),
    ("3John", "3 John"),
    ("Jude", "Jude"),
    ("Rev", "Revelation"),
];

/// Extra spellings seen in other software, already normalized (see [`normalize`]).
const ALIASES: [(&str, i32); 13] = [
    ("psalm", 19),
    ("psa", 19),
    ("songofsongs", 22),
    ("canticles", 22),
    ("canticleofcanticles", 22),
    ("qoheleth", 21),
    ("revelations", 66),
    ("revelationofjohn", 66),
    ("apocalypse", 66),
    ("actsoftheapostles", 44),
    ("phm", 57),
    ("jdg", 7),
    ("mrk", 41),
];

pub const BOOK_COUNT: i32 = 66;

/// Default English name for a canonical book number (1..=66).
pub fn default_name(number: i32) -> Option<&'static str> {
    entry(number).map(|(_, name)| name)
}

/// Bundled-style abbreviation (OSIS id) for a canonical book number.
pub fn default_abbreviation(number: i32) -> Option<&'static str> {
    entry(number).map(|(abbreviation, _)| abbreviation)
}

/// `"OT"` for books 1–39, `"NT"` for 40–66, matching the bundled database.
pub fn testament(number: i32) -> &'static str {
    if number <= 39 {
        "OT"
    } else {
        "NT"
    }
}

/// Book number for an OSIS book id such as `Gen`, `1Kgs` or `Rev`.
pub fn number_from_osis(osis: &str) -> Option<i32> {
    CANON
        .iter()
        .position(|(id, _)| id.eq_ignore_ascii_case(osis))
        .and_then(|index| i32::try_from(index + 1).ok())
        .or_else(|| number_from_name(osis))
}

/// Book number for an English book name or abbreviation (`"1 Kings"`,
/// `"I Kings"`, `"Psalm"`, `"Song of Songs"`, `"Rev"`…).
pub fn number_from_name(name: &str) -> Option<i32> {
    let key = normalize(name);
    if key.is_empty() {
        return None;
    }
    CANON
        .iter()
        .position(|(id, full)| normalize(full) == key || normalize(id) == key)
        .and_then(|index| i32::try_from(index + 1).ok())
        .or_else(|| {
            ALIASES
                .iter()
                .find(|(alias, _)| *alias == key)
                .map(|(_, number)| *number)
        })
}

fn entry(number: i32) -> Option<(&'static str, &'static str)> {
    let index = usize::try_from(number.checked_sub(1)?).ok()?;
    CANON.get(index).copied()
}

/// Lower-case alphanumerics only, with a leading roman/ordinal word turned
/// into a digit: `"II Kings"` → `"2kings"`, `"First John"` → `"1john"`.
fn normalize(name: &str) -> String {
    let lower = name.trim().to_lowercase();
    let mut words = lower.split_whitespace();
    let first = words.next().unwrap_or_default();
    let prefix = match first.trim_end_matches('.') {
        "i" | "first" | "1st" => Some('1'),
        "ii" | "second" | "2nd" => Some('2'),
        "iii" | "third" | "3rd" => Some('3'),
        _ => None,
    };
    let mut out = String::new();
    let rest: Vec<&str> = if let Some(digit) = prefix {
        out.push(digit);
        words.collect()
    } else {
        std::iter::once(first).chain(words).collect()
    };
    for word in rest {
        out.extend(word.chars().filter(|c| c.is_alphanumeric()));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canon_matches_bundled_style() {
        assert_eq!(default_name(1), Some("Genesis"));
        assert_eq!(default_abbreviation(19), Some("Ps"));
        assert_eq!(default_abbreviation(66), Some("Rev"));
        assert_eq!(default_name(67), None);
        assert_eq!(default_name(0), None);
        assert_eq!(testament(39), "OT");
        assert_eq!(testament(40), "NT");
    }

    #[test]
    fn names_and_osis_ids_resolve() {
        assert_eq!(number_from_osis("Gen"), Some(1));
        assert_eq!(number_from_osis("1Kgs"), Some(11));
        assert_eq!(number_from_osis("Rev"), Some(66));
        assert_eq!(number_from_osis("Tob"), None);
        assert_eq!(number_from_name("Psalm"), Some(19));
        assert_eq!(number_from_name("II Kings"), Some(12));
        assert_eq!(number_from_name("First John"), Some(62));
        assert_eq!(number_from_name("Song of Songs"), Some(22));
        assert_eq!(number_from_name("Revelation"), Some(66));
        assert_eq!(number_from_name("Tobit"), None);
    }
}
