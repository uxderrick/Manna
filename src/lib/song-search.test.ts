import { describe, expect, test } from "vitest"
import { searchSongs } from "./song-search"
import type { Song } from "@/types"

const songs: Song[] = [
  {
    id: "ghs-1",
    source: "ghs",
    number: 1,
    title: "All Your Anxiety",
    author: null,
    stanzas: [{ id: "v1", kind: "verse", lines: ["Is there a heart o'er-bound by sorrow"] }],
    chorus: null,
    autoChorus: true,
    lineMode: "stanza-full",
    tune: null,
    meter: null,
    scriptureRef: null,
    category: null,
  },
  {
    id: "ghs-42",
    source: "ghs",
    number: 42,
    title: "Amazing Grace",
    author: "John Newton",
    stanzas: [{ id: "v1", kind: "verse", lines: ["Amazing grace how sweet the sound"] }],
    chorus: null,
    autoChorus: true,
    lineMode: "stanza-full",
    tune: null,
    meter: null,
    scriptureRef: null,
    category: null,
  },
  {
    id: "custom-1",
    source: "custom",
    number: null,
    title: "Blessed Assurance",
    author: null,
    stanzas: [{ id: "v1", kind: "verse", lines: ["This is my story"] }],
    chorus: null,
    autoChorus: true,
    lineMode: "stanza-full",
    tune: null,
    meter: null,
    scriptureRef: null,
    category: null,
  },
]

describe("searchSongs", () => {
  test("empty query returns all songs", () => {
    const out = searchSongs(songs, "")
    expect(out.length).toBe(3)
  })

  test("numeric query → GHS number lookup first", () => {
    const out = searchSongs(songs, "42")
    expect(out[0].id).toBe("ghs-42")
  })

  test("title fuzzy match", () => {
    const out = searchSongs(songs, "amazing")
    expect(out[0].id).toBe("ghs-42")
  })

  test("first-line match", () => {
    const out = searchSongs(songs, "sweet sound")
    expect(out.some((s) => s.id === "ghs-42")).toBe(true)
  })

  test("author match", () => {
    const out = searchSongs(songs, "newton")
    expect(out.some((s) => s.id === "ghs-42")).toBe(true)
  })

  test("no match returns empty", () => {
    const out = searchSongs(songs, "xxxxyyyyzzzz")
    expect(out.length).toBe(0)
  })

  test("'mhb 42' scoped hymnal number lookup", () => {
    const multi: Song[] = [
      ...songs,
      {
        id: "mhb-42",
        source: "mhb",
        number: 42,
        title: "Amazing Grace MHB",
        author: null,
        stanzas: [],
        chorus: null,
        autoChorus: true,
        lineMode: "stanza-full",
        tune: null,
        meter: null,
        scriptureRef: null,
        category: null,
      },
    ]
    const out = searchSongs(multi, "mhb 42")
    expect(out.length).toBe(1)
    expect(out[0].id).toBe("mhb-42")
  })

  test("'snk 150' is alias for sankey", () => {
    const multi: Song[] = [
      ...songs,
      {
        id: "sankey-150",
        source: "sankey",
        number: 150,
        title: "Sankey Song",
        author: null,
        stanzas: [],
        chorus: null,
        autoChorus: true,
        lineMode: "stanza-full",
        tune: null,
        meter: null,
        scriptureRef: null,
        category: null,
      },
    ]
    const out = searchSongs(multi, "snk 150")
    expect(out[0]?.id).toBe("sankey-150")
  })

  test("'sda 1' scoped lookup", () => {
    const multi: Song[] = [
      ...songs,
      {
        id: "sda-1",
        source: "sda",
        number: 1,
        title: "SDA Hymn",
        author: null,
        stanzas: [],
        chorus: null,
        autoChorus: true,
        lineMode: "stanza-full",
        tune: null,
        meter: null,
        scriptureRef: null,
        category: null,
      },
    ]
    const out = searchSongs(multi, "sda 1")
    expect(out[0]?.id).toBe("sda-1")
  })
})
