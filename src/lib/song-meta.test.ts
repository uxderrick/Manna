import { describe, expect, test } from "vitest"
import { songMeta } from "./song-meta"
import type { Song, SongStanza } from "@/types"

const base: Song = {
  id: "ghs-42",
  source: "ghs",
  number: 42,
  title: "Amazing Grace",
  author: null,
  stanzas: [],
  chorus: null,
  autoChorus: true,
  lineMode: "stanza-full",
  tune: null,
  meter: null,
  scriptureRef: null,
  category: null,
}

const verse: SongStanza = { id: "v1", kind: "verse", lines: [] }
const chorus: SongStanza = { id: "ch", kind: "chorus", lines: [] }

describe("songMeta", () => {
  test("GHS verse with number prefix", () => {
    expect(songMeta(base, verse, 0)).toBe("GHS 42 · Verse 1")
  })

  test("GHS chorus label", () => {
    expect(songMeta(base, chorus, 0)).toBe("GHS 42 · Chorus")
  })

  test("MHB verse uses MHB prefix", () => {
    const s = { ...base, source: "mhb" as const, number: 42 }
    expect(songMeta(s, verse, 0)).toBe("MHB 42 · Verse 1")
  })

  test("Sankey verse uses SNK prefix", () => {
    const s = { ...base, source: "sankey" as const, number: 150 }
    expect(songMeta(s, verse, 0)).toBe("SNK 150 · Verse 1")
  })

  test("SDA verse uses SDA prefix", () => {
    const s = { ...base, source: "sda" as const, number: 1 }
    expect(songMeta(s, verse, 0)).toBe("SDA 1 · Verse 1")
  })

  test("No number falls back to title", () => {
    const s = { ...base, number: null, title: "Custom Song" }
    expect(songMeta(s, verse, 1)).toBe("Custom Song · Verse 2")
  })

  test("Chorus with no number uses title", () => {
    const s = { ...base, number: null, title: "My Song" }
    expect(songMeta(s, chorus, 0)).toBe("My Song · Chorus")
  })

  test("Custom source uses title even when number-like", () => {
    const s = { ...base, source: "custom" as const, number: 5, title: "Pasted Hymn" }
    expect(songMeta(s, verse, 0)).toBe("Pasted Hymn · Verse 1")
  })
})
