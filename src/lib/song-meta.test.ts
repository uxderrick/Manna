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
}

const verse: SongStanza = { id: "v1", kind: "verse", lines: [] }
const chorus: SongStanza = { id: "ch", kind: "chorus", lines: [] }

describe("songMeta", () => {
  test("GHS verse with number prefix", () => {
    expect(songMeta(base, verse, 0)).toBe("Hymn 42 · Verse 1")
  })

  test("GHS chorus label", () => {
    expect(songMeta(base, chorus, 0)).toBe("Hymn 42 · Chorus")
  })

  test("No number falls back to title", () => {
    const s = { ...base, number: null, title: "Custom Song" }
    expect(songMeta(s, verse, 1)).toBe("Custom Song · Verse 2")
  })

  test("Chorus with no number uses title", () => {
    const s = { ...base, number: null, title: "My Song" }
    expect(songMeta(s, chorus, 0)).toBe("My Song · Chorus")
  })
})
