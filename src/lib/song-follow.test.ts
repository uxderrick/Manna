import { describe, expect, it } from "vitest"
import type { QueueItem, Song } from "@/types"
import { expandSong } from "./song-expand"
import { activeSongId, positionStanzas, shouldMove, slideFor, stanzaLabel } from "./song-follow"

function song(lineMode: Song["lineMode"] = "stanza-full"): Song {
  return {
    id: "s",
    source: "custom",
    number: null,
    title: "No One Like the Lord",
    author: null,
    stanzas: [
      { id: "v1", kind: "verse", lines: ["Holy is the Lamb", "Who was slain and seated on the throne"] },
      { id: "v2", kind: "verse", lines: ["Elders, creatures bow", "Angels sing His praise"] },
    ],
    chorus: { id: "c", kind: "chorus", lines: ["There's no one like the Lord", "No one like our God"] },
    autoChorus: true,
    lineMode,
    tune: null,
    meter: null,
    scriptureRef: null,
    category: null,
    createdAt: 0,
  } as Song
}

/** The queue after presenting the song: a hymn before it, its slides in order. */
function queue(s: Song): QueueItem[] {
  const before = { kind: "song-stanza", id: "x", songId: "other", stanzaId: "o", expandedIndex: 0, reference: "", text: "", source: "manual", added_at: 0 }
  const slides = expandSong(s).map((e, i) => ({
    kind: "song-stanza",
    id: `q${i}`,
    songId: s.id,
    stanzaId: e.stanzaRefId,
    expandedIndex: i,
    reference: "",
    text: e.text,
    source: "manual",
    added_at: 0,
  }))
  return [before, ...slides] as QueueItem[]
}

describe("song following", () => {
  // Slides: 0 other song | 1 v1 | 2 chorus | 3 v2 | 4 chorus
  const s = song()
  const items = queue(s)

  it("counts stanzas the way song detection does", () => {
    expect(positionStanzas(s).map((x) => x.id)).toEqual(["v1", "v2", "c"])
    expect(stanzaLabel(s, "c")).toBe("Chorus")
    expect(stanzaLabel(s, "v2")).toBe("Verse 2")
    expect(activeSongId(items, 2)).toBe("s")
  })

  it("stays on a slide while its first line is sung, moves on at its last line", () => {
    expect(slideFor(items, 1, s, { stanza: 0, line: 0 })).toBe(1)
    expect(slideFor(items, 1, s, { stanza: 0, line: 1 })).toBe(2)
    expect(slideFor(items, 1, s, { stanza: 0, line: 1 }, false)).toBe(1)
  })

  it("finds the right repeat of the chorus", () => {
    // The chorus after verse 1, then the one after verse 2.
    expect(slideFor(items, 1, s, { stanza: 2, line: 0 })).toBe(2)
    expect(slideFor(items, 3, s, { stanza: 2, line: 0 })).toBe(4)
    // The song's last slide stays.
    expect(slideFor(items, 4, s, { stanza: 2, line: 1 })).toBe(4)
  })

  it("can go back to an earlier verse", () => {
    expect(slideFor(items, 4, s, { stanza: 0, line: 0 })).toBe(1)
  })

  it("follows line by line when slides hold one line", () => {
    const one = song("line")
    // Slides: 0 other | 1-2 v1 | 3-4 chorus | 5-6 v2 | 7-8 chorus
    const q = queue(one)
    expect(slideFor(q, 1, one, { stanza: 0, line: 0 })).toBe(2)
    expect(slideFor(q, 5, one, { stanza: 1, line: 0 }, false)).toBe(5)
    expect(slideFor(q, 5, one, { stanza: 2, line: 0 }, false)).toBe(7)
  })

  it("ignores positions when another song is active", () => {
    expect(slideFor(items, 0, s, { stanza: 0, line: 0 })).toBeNull()
  })

  it("moves forward at once, back only when heard twice", () => {
    expect(shouldMove(3, 1, null)).toBe(true)
    expect(shouldMove(1, 3, null)).toBe(false)
    expect(shouldMove(1, 3, 1)).toBe(true)
    expect(shouldMove(2, 2, null)).toBe(false)
  })
})
