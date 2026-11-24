//! Schema-less protobuf wire-format reader, enough to pull fields out of
//! ProPresenter 7 documents without generated code.
//!
//! Field numbers come from the community-documented ProPresenter 7 schema
//! (github.com/greyshirtguy/ProPresenter7-Proto, MIT). Malformed input stops
//! decoding at the bad byte; callers get whatever was read before it.

/// One decoded field. Only the wire types ProPresenter uses are kept.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Value<'a> {
    Varint(u64),
    Bytes(&'a [u8]),
    Fixed64,
    Fixed32,
}

/// A view over one encoded message.
#[derive(Debug, Clone, Copy)]
pub struct Message<'a>(pub &'a [u8]);

fn varint(buf: &[u8], pos: &mut usize) -> Option<u64> {
    let mut out = 0u64;
    for shift in (0..64).step_by(7) {
        let byte = *buf.get(*pos)?;
        *pos += 1;
        out |= u64::from(byte & 0x7F) << shift;
        if byte & 0x80 == 0 {
            return Some(out);
        }
    }
    None
}

impl<'a> Message<'a> {
    /// All `(field_number, value)` pairs in encoded order.
    pub fn fields(self) -> Vec<(u32, Value<'a>)> {
        let buf = self.0;
        let mut out = Vec::new();
        let mut pos = 0;
        while pos < buf.len() {
            let Some(key) = varint(buf, &mut pos) else { break };
            let Ok(field) = u32::try_from(key >> 3) else { break };
            let value = match key & 7 {
                0 => match varint(buf, &mut pos) {
                    Some(v) => Value::Varint(v),
                    None => break,
                },
                1 => {
                    pos += 8;
                    Value::Fixed64
                }
                2 => {
                    let Some(len) = varint(buf, &mut pos).and_then(|l| usize::try_from(l).ok()) else { break };
                    let Some(bytes) = pos.checked_add(len).and_then(|end| buf.get(pos..end)) else { break };
                    pos += len;
                    Value::Bytes(bytes)
                }
                5 => {
                    pos += 4;
                    Value::Fixed32
                }
                _ => break, // groups (3/4) are deprecated and unused here
            };
            if pos > buf.len() {
                break;
            }
            out.push((field, value));
        }
        out
    }

    /// Every length-delimited payload for `field` (repeated or single).
    pub fn all_bytes(self, field: u32) -> Vec<&'a [u8]> {
        self.fields()
            .into_iter()
            .filter_map(|(f, v)| match v {
                Value::Bytes(b) if f == field => Some(b),
                _ => None,
            })
            .collect()
    }

    pub fn bytes(self, field: u32) -> Option<&'a [u8]> {
        self.all_bytes(field).into_iter().next()
    }

    pub fn message(self, field: u32) -> Option<Message<'a>> {
        self.bytes(field).map(Message)
    }

    pub fn messages(self, field: u32) -> Vec<Message<'a>> {
        self.all_bytes(field).into_iter().map(Message).collect()
    }

    /// A string field; invalid UTF-8 is replaced rather than rejected.
    pub fn string(self, field: u32) -> Option<String> {
        self.bytes(field).map(|b| String::from_utf8_lossy(b).into_owned())
    }

    pub fn varint(self, field: u32) -> Option<u64> {
        self.fields().into_iter().find_map(|(f, v)| match v {
            Value::Varint(n) if f == field => Some(n),
            _ => None,
        })
    }

    /// Follow a chain of single sub-messages, e.g. `path(&[1, 2])`.
    pub fn path(self, fields: &[u32]) -> Option<Message<'a>> {
        fields.iter().try_fold(self, |m, &f| m.message(f))
    }
}

/// `rv.data.UUID { string string = 1; }`
pub fn uuid(msg: Message<'_>) -> Option<String> {
    msg.string(1).map(|s| s.to_uppercase())
}

#[cfg(test)]
pub(crate) mod encode {
    //! Tiny encoder for building test documents.

    pub fn varint(mut v: u64, out: &mut Vec<u8>) {
        loop {
            let byte = (v & 0x7F) as u8;
            v >>= 7;
            if v == 0 {
                out.push(byte);
                return;
            }
            out.push(byte | 0x80);
        }
    }

    pub fn bytes(field: u32, payload: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        varint(u64::from(field) << 3 | 2, &mut out);
        varint(payload.len() as u64, &mut out);
        out.extend_from_slice(payload);
        out
    }

    pub fn string(field: u32, s: &str) -> Vec<u8> {
        bytes(field, s.as_bytes())
    }

    pub fn int(field: u32, v: u64) -> Vec<u8> {
        let mut out = Vec::new();
        varint(u64::from(field) << 3, &mut out);
        varint(v, &mut out);
        out
    }

    pub fn msg(field: u32, parts: &[Vec<u8>]) -> Vec<u8> {
        bytes(field, &parts.concat())
    }
}

#[cfg(test)]
mod tests {
    use super::encode::{int, msg, string};
    use super::*;

    #[test]
    fn reads_nested_and_repeated_fields() {
        let doc = [
            string(3, "Way Maker"),
            int(5, 300),
            msg(12, &[string(2, "Verse 1")]),
            msg(12, &[string(2, "Chorus")]),
        ]
        .concat();
        let m = Message(&doc);
        assert_eq!(m.string(3).as_deref(), Some("Way Maker"));
        assert_eq!(m.varint(5), Some(300));
        let names: Vec<_> = m.messages(12).into_iter().filter_map(|g| g.string(2)).collect();
        assert_eq!(names, ["Verse 1", "Chorus"]);
    }

    #[test]
    fn truncated_input_keeps_what_was_read() {
        let mut doc = string(3, "Title");
        doc.extend_from_slice(&[0x12, 0x40, b'x']); // field 2, claims 64 bytes
        let m = Message(&doc);
        assert_eq!(m.string(3).as_deref(), Some("Title"));
        assert!(m.bytes(2).is_none());
    }
}
