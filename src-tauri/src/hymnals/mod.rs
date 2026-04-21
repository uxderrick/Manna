//! Registry of hymnals bundled into the binary via `include_str!`.
//!
//! Each `HymnalDef` has a stable string id (used as `songs.source` value),
//! a human display name, the embedded JSON content, and a `seed_version`
//! bumped when hymnal data is updated.

pub struct HymnalDef {
    pub id: &'static str,
    pub name: &'static str,
    pub json: &'static str,
    pub seed_version: i64,
}

pub const HYMNALS: &[HymnalDef] = &[
    HymnalDef {
        id: "ghs",
        name: "DCLM (GHS)",
        json: include_str!("../../hymnals/ghs.json"),
        seed_version: 1,
    },
    HymnalDef {
        id: "mhb",
        name: "Methodist",
        json: include_str!("../../hymnals/mhb.json"),
        seed_version: 1,
    },
    HymnalDef {
        id: "sankey",
        name: "Sankey",
        json: include_str!("../../hymnals/sankey.json"),
        seed_version: 1,
    },
    HymnalDef {
        id: "sda",
        name: "SDA",
        json: include_str!("../../hymnals/sda.json"),
        seed_version: 1,
    },
];

/// Find a `HymnalDef` by its string id.
pub fn find_hymnal(id: &str) -> Option<&'static HymnalDef> {
    HYMNALS.iter().find(|h| h.id == id)
}
