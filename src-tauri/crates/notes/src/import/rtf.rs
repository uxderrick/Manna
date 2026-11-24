//! Minimal RTF → plain text, enough for EasyWorship song lyrics.
//!
//! Handles groups, ignorable destinations (`{\*…}`, font/colour/style
//! tables), `\par`/`\line`, `\'hh` (Windows-1252), `\uN` with `\ucN` fallback
//! skipping, and escaped braces. EasyWorship's `\sdslidemarker` slide break is
//! emitted as [`SLIDE_MARKER`] so the caller can split slides.

use super::text::cp1252_char;

pub const SLIDE_MARKER: char = '\u{1E}';

/// Destinations whose content is never visible text.
const SKIP_DESTINATIONS: &[&str] = &[
    "fonttbl", "colortbl", "stylesheet", "info", "pict", "header", "footer", "headerl",
    "headerr", "footerl", "footerr", "object", "listtable", "listoverridetable",
    "rsidtbl", "generator", "themedata", "datastore", "latentstyles", "xmlnstbl",
];

struct Group {
    skip: bool,
    uc: usize,
}

pub fn rtf_to_text(rtf: &str) -> String {
    let chars: Vec<char> = rtf.chars().collect();
    let mut out = String::new();
    let mut stack = vec![Group { skip: false, uc: 1 }];
    // Fallback characters still to drop after a `\uN`.
    let mut pending_skip = 0usize;
    let mut i = 0;

    while i < chars.len() {
        let c = chars[i];
        match c {
            '{' => {
                let parent = stack.last().map_or(Group { skip: false, uc: 1 }, |g| Group { skip: g.skip, uc: g.uc });
                stack.push(parent);
                pending_skip = 0;
                i += 1;
            }
            '}' => {
                if stack.len() > 1 {
                    stack.pop();
                }
                pending_skip = 0;
                i += 1;
            }
            '\\' => {
                i += 1;
                let Some(&next) = chars.get(i) else { break };
                if next == '\'' {
                    // \'hh hex byte
                    let hex: String = chars.iter().skip(i + 1).take(2).collect();
                    i += 1 + hex.len();
                    if let Ok(b) = u8::from_str_radix(&hex, 16) {
                        emit(&mut out, &stack, &mut pending_skip, cp1252_char(b));
                    }
                } else if next.is_ascii_alphabetic() {
                    let start = i;
                    while i < chars.len() && chars[i].is_ascii_alphabetic() {
                        i += 1;
                    }
                    let word: String = chars[start..i].iter().collect();
                    let num_start = i;
                    if i < chars.len() && (chars[i] == '-' || chars[i].is_ascii_digit()) {
                        i += 1;
                        while i < chars.len() && chars[i].is_ascii_digit() {
                            i += 1;
                        }
                    }
                    let param: Option<i32> = chars[num_start..i].iter().collect::<String>().parse().ok();
                    if i < chars.len() && chars[i] == ' ' {
                        i += 1;
                    }
                    control_word(&word, param, &mut out, &mut stack, &mut pending_skip);
                } else {
                    // Control symbol.
                    i += 1;
                    match next {
                        '*' => {
                            if let Some(g) = stack.last_mut() {
                                g.skip = true;
                            }
                        }
                        '~' => emit(&mut out, &stack, &mut pending_skip, ' '),
                        '_' => emit(&mut out, &stack, &mut pending_skip, '-'),
                        '\\' | '{' | '}' => emit(&mut out, &stack, &mut pending_skip, next),
                        '\n' | '\r' => emit(&mut out, &stack, &mut pending_skip, '\n'),
                        _ => {}
                    }
                }
            }
            '\r' | '\n' => i += 1,
            _ => {
                emit(&mut out, &stack, &mut pending_skip, c);
                i += 1;
            }
        }
    }
    out
}

fn emit(out: &mut String, stack: &[Group], pending_skip: &mut usize, c: char) {
    if *pending_skip > 0 {
        *pending_skip -= 1;
        return;
    }
    if !stack.last().is_some_and(|g| g.skip) {
        out.push(c);
    }
}

fn control_word(
    word: &str,
    param: Option<i32>,
    out: &mut String,
    stack: &mut [Group],
    pending_skip: &mut usize,
) {
    let Some(group) = stack.last_mut() else { return };
    match word {
        // Slide breaks matter even if EasyWorship tucks them in a `\*` group.
        "sdslidemarker" => out.push(SLIDE_MARKER),
        _ if SKIP_DESTINATIONS.contains(&word) => group.skip = true,
        _ if group.skip => {}
        "par" | "line" | "sect" | "page" => out.push('\n'),
        "tab" => out.push(' '),
        "emdash" => out.push('\u{2014}'),
        "endash" => out.push('\u{2013}'),
        "lquote" => out.push('\u{2018}'),
        "rquote" => out.push('\u{2019}'),
        "ldblquote" => out.push('\u{201C}'),
        "rdblquote" => out.push('\u{201D}'),
        "bullet" => out.push('\u{2022}'),
        "uc" => group.uc = param.and_then(|p| usize::try_from(p).ok()).unwrap_or(1),
        "u" => {
            if let Some(p) = param {
                let code = if p < 0 { p + 65536 } else { p };
                if let Some(ch) = u32::try_from(code).ok().and_then(char::from_u32) {
                    out.push(ch);
                }
                *pending_skip = group.uc;
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_tables_and_formatting() {
        let rtf = r"{\rtf1\ansi\deff0{\fonttbl{\f0 Tahoma;}}{\colortbl ;\red0\green0\blue0;}\f0\fs36 Amazing grace\par How sweet\line the sound\par}";
        assert_eq!(rtf_to_text(rtf), "Amazing grace\nHow sweet\nthe sound\n");
    }

    #[test]
    fn decodes_hex_unicode_and_escapes() {
        let rtf = r"{\rtf1 \'93Lord\'94 caf\u233?e \{x\} \u8217\'92s}";
        assert_eq!(rtf_to_text(rtf), "\u{201C}Lord\u{201D} caf\u{e9}e {x} \u{2019}s");
    }

    #[test]
    fn ignorable_destinations_are_dropped_but_slide_markers_kept() {
        let rtf = r"{\rtf1{\pard\sdslidemarker\par}{\pard{\*\sdfsreal 36}\sdfsauto Line one\par}{\pard{\*\sdslidemarker}\par}{\pard Line two\par}}";
        let text = rtf_to_text(rtf);
        assert_eq!(text, format!("{SLIDE_MARKER}\nLine one\n{SLIDE_MARKER}\nLine two\n"));
    }
}
