import { beforeEach, describe, expect, it } from "vitest"
import { mergeSongMatches, useSongMatchStore } from "./song-match-store"

const item = (songId: string, score: number, extra: Partial<{ stanza: number; line: string }> = {}) => ({
  songId,
  score,
  stanza: extra.stanza ?? null,
  line: extra.line ?? null,
})

describe("song match store", () => {
  beforeEach(() => useSongMatchStore.getState().clear())

  it("keeps the last matches when a result is empty", () => {
    const s = useSongMatchStore.getState()
    s.receive({ source: "lyrics", matches: [item("a", 0.6)], confident: true }, 1)
    s.receive({ source: "lyrics", matches: [], confident: false }, 2)
    expect(useSongMatchStore.getState().bySource.lyrics?.matches[0].songId).toBe("a")
  })

  it("merges lyrics and sound per song, confident first", () => {
    const s = useSongMatchStore.getState()
    s.receive({ source: "lyrics", matches: [item("b", 0.3), item("a", 0.25, { stanza: 1, line: "Then sings my soul" })], confident: false }, 1)
    s.receive({ source: "sound", matches: [item("a", 0.5)], confident: true }, 2)
    const merged = mergeSongMatches(useSongMatchStore.getState().bySource)
    expect(merged.map((m) => m.songId)).toEqual(["a", "b"])
    expect(merged[0]).toMatchObject({ sources: ["lyrics", "sound"], confident: true, score: 0.5, stanza: 1, line: "Then sings my soul" })
  })

  it("puts the last song aside when singing stops", () => {
    const s = useSongMatchStore.getState()
    s.receive({ source: "lyrics", matches: [item("silent-night", 0.54), item("other", 0.3)], confident: true }, 1)
    s.putAside()
    let state = useSongMatchStore.getState()
    expect(mergeSongMatches(state.bySource)).toEqual([])
    expect(state.earlier.map((m) => m.songId)).toEqual(["silent-night", "other"])
    // The next song pushes older ones down; nothing to put aside twice.
    s.receive({ source: "lyrics", matches: [item("no-one-like-the-lord", 0.52)], confident: true }, 2)
    s.putAside()
    s.putAside()
    state = useSongMatchStore.getState()
    expect(state.earlier.map((m) => m.songId)).toEqual(["no-one-like-the-lord", "silent-night", "other"])
  })
})
