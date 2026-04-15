/// Returns Bible book names, common abbreviations, spoken forms, and theological terms
/// for use as Deepgram keyword boosting.
#[allow(clippy::too_many_lines)]
pub fn bible_keyterms() -> Vec<String> {
    let mut terms: Vec<String> = Vec::new();

    // Highest priority first — these are most commonly misheard.
    // Bare proper names that Deepgram hears wrong ("Peter" → "beta").
    let bare_names = [
        "Peter", "Paul", "Moses", "Abraham", "Isaac", "Jacob", "Joseph",
        "David", "Solomon", "Elijah", "Elisha", "Mary", "Martha", "Lazarus",
        "Barnabas", "Zacchaeus", "Nicodemus",
    ];
    terms.extend(bare_names.iter().map(ToString::to_string));

    // Translation abbreviations — misheard as everyday words.
    let translations = ["NIV", "ESV", "NASB", "NKJV", "NLT", "KJV", "AMP"];
    terms.extend(translations.iter().map(ToString::to_string));

    // 66 Bible book names
    let books = [
        "Genesis",
        "Exodus",
        "Leviticus",
        "Numbers",
        "Deuteronomy",
        "Joshua",
        "Judges",
        "Ruth",
        "1 Samuel",
        "2 Samuel",
        "1 Kings",
        "2 Kings",
        "1 Chronicles",
        "2 Chronicles",
        "Ezra",
        "Nehemiah",
        "Esther",
        "Job",
        "Psalms",
        "Proverbs",
        "Ecclesiastes",
        "Song of Solomon",
        "Isaiah",
        "Jeremiah",
        "Lamentations",
        "Ezekiel",
        "Daniel",
        "Hosea",
        "Joel",
        "Amos",
        "Obadiah",
        "Jonah",
        "Micah",
        "Nahum",
        "Habakkuk",
        "Zephaniah",
        "Haggai",
        "Zechariah",
        "Malachi",
        "Matthew",
        "Mark",
        "Luke",
        "John",
        "Acts",
        "Romans",
        "1 Corinthians",
        "2 Corinthians",
        "Galatians",
        "Ephesians",
        "Philippians",
        "Colossians",
        "1 Thessalonians",
        "2 Thessalonians",
        "1 Timothy",
        "2 Timothy",
        "Titus",
        "Philemon",
        "Hebrews",
        "James",
        "1 Peter",
        "2 Peter",
        "1 John",
        "2 John",
        "3 John",
        "Jude",
        "Revelation",
    ];
    terms.extend(books.iter().map(ToString::to_string));

    // Common abbreviations
    let abbreviations = [
        "Gen", "Exod", "Lev", "Num", "Deut", "Josh", "Judg", "Sam", "Kgs", "Chr", "Neh",
        "Esth", "Ps", "Prov", "Eccl", "Isa", "Jer", "Lam", "Ezek", "Dan", "Hos", "Obad",
        "Mic", "Nah", "Hab", "Zeph", "Hag", "Zech", "Mal", "Matt", "Mk", "Lk", "Jn", "Rom",
        "Cor", "Gal", "Eph", "Phil", "Col", "Thess", "Tim", "Tit", "Phlm", "Heb", "Jas",
        "Pet", "Rev",
    ];
    terms.extend(abbreviations.iter().map(ToString::to_string));

    // Spoken forms
    let spoken = [
        "First Samuel",
        "Second Samuel",
        "First Kings",
        "Second Kings",
        "First Chronicles",
        "Second Chronicles",
        "First Corinthians",
        "Second Corinthians",
        "First Thessalonians",
        "Second Thessalonians",
        "First Timothy",
        "Second Timothy",
        "First Peter",
        "Second Peter",
        "First John",
        "Second John",
        "Third John",
        "Song of Songs",
    ];
    terms.extend(spoken.iter().map(ToString::to_string));

    // Theological terms
    let theological = [
        "justification",
        "sanctification",
        "propitiation",
        "eschatology",
        "atonement",
        "redemption",
        "righteousness",
        "covenant",
        "baptism",
        "resurrection",
        "crucifixion",
        "salvation",
        "repentance",
        "grace",
        "mercy",
        "forgiveness",
        "reconciliation",
        "glorification",
        "predestination",
        "sovereignty",
        "omniscience",
        "omnipotence",
        "trinity",
        "incarnation",
        "ascension",
        "transfiguration",
        "beatitudes",
        "tabernacle",
        "ark of the covenant",
        "Melchizedek",
        "Nebuchadnezzar",
    ];
    terms.extend(theological.iter().map(ToString::to_string));

    terms
}

/// Returns the deduplicated priority keyterm list used for both Deepgram and
/// AssemblyAI keyword boosting, capped at `max` entries.
///
/// Order: core theology-critical terms first (always retained), then
/// [`bible_keyterms`] (names/books/translations/theological vocabulary).
pub fn priority_keyterms(max: usize) -> Vec<String> {
    const CORE_TERMS: [&str; 5] = ["Jesus", "Christ", "God", "Lord", "Holy Spirit"];

    let mut seen = std::collections::HashSet::new();
    let mut out: Vec<String> = Vec::new();
    for term in CORE_TERMS
        .iter()
        .map(|s| (*s).to_string())
        .chain(bible_keyterms())
    {
        if seen.insert(term.clone()) {
            out.push(term);
        }
        if out.len() >= max {
            break;
        }
    }
    out
}
