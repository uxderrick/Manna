import { describe, expect, test } from "vitest"
import { expandSong, stanzaToText } from "./song-expand"
import type { Song } from "@/types"

const makeSong = (overrides: Partial<Song> = {}): Song => ({
  id: "ghs-1",
  source: "ghs",
  number: 1,
  title: "Test Hymn",
  author: null,
  stanzas: [
    { id: "v1", kind: "verse", lines: ["Line A1", "Line A2", "Line A3", "Line A4"] },
    { id: "v2", kind: "verse", lines: ["Line B1", "Line B2"] },
  ],
  chorus: { id: "ch", kind: "chorus", lines: ["Chorus 1", "Chorus 2"] },
  autoChorus: true,
  lineMode: "stanza-full",
  tune: null,
  meter: null,
  scriptureRef: null,
  category: null,
  ...overrides,
})

describe("expandSong", () => {
  test("stanza-full + autoChorus interleaves chorus between verses", () => {
    const out = expandSong(makeSong())
    expect(out.map((i) => i.stanzaRefId)).toEqual(["v1", "ch", "v2", "ch"])
  })

  test("stanza-full without autoChorus skips chorus", () => {
    const out = expandSong(makeSong({ autoChorus: false }))
    expect(out.map((i) => i.stanzaRefId)).toEqual(["v1", "v2"])
  })

  test("no chorus present → no interleave regardless of autoChorus", () => {
    const out = expandSong(makeSong({ chorus: null }))
    expect(out.map((i) => i.stanzaRefId)).toEqual(["v1", "v2"])
  })

  test("stanza-pair groups lines into 2-line chunks", () => {
    const out = expandSong(makeSong({ autoChorus: false, lineMode: "stanza-pair" }))
    expect(out.length).toBe(3)
    expect(out[0].text).toBe("Line A1\nLine A2")
    expect(out[1].text).toBe("Line A3\nLine A4")
    expect(out[2].text).toBe("Line B1\nLine B2")
  })

  test("line mode emits one item per line", () => {
    const out = expandSong(makeSong({ autoChorus: false, lineMode: "line" }))
    expect(out.length).toBe(6)
    expect(out[0].text).toBe("Line A1")
    expect(out[5].text).toBe("Line B2")
  })

  test("stanza-pair + autoChorus still interleaves chorus after each verse's pair set", () => {
    const out = expandSong(makeSong({ lineMode: "stanza-pair" }))
    expect(out.map((i) => i.text)).toEqual([
      "Line A1\nLine A2",
      "Line A3\nLine A4",
      "Chorus 1\nChorus 2",
      "Line B1\nLine B2",
      "Chorus 1\nChorus 2",
    ])
  })
})

describe("stanzaToText", () => {
  test("joins lines with newlines", () => {
    expect(stanzaToText({ id: "v1", kind: "verse", lines: ["A", "B"] })).toBe("A\nB")
  })
})
