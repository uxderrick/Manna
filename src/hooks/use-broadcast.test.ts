import { describe, expect, it } from "vitest"
import type { Verse } from "@/types"
import { deriveLiveVerse, queueVerseToRenderData } from "./use-broadcast"

const sampleVerse: Verse = {
  id: 1,
  translation_id: 1,
  book_number: 1,
  book_name: "Genesis",
  book_abbreviation: "Gen",
  chapter: 1,
  verse: 2,
  text: "The earth was without form and void.",
}

describe("deriveLiveVerse", () => {
  it("copies valid queue-item highlights into render data", () => {
    const render = queueVerseToRenderData({
      kind: "verse",
      id: "q-1",
      source: "manual",
      added_at: 1,
      verse: sampleVerse,
      reference: "Genesis 1:2",
      confidence: 1,
      highlights: [{ segmentIndex: 0, start: 0, end: 3, color: "#FACC15", sourceText: "The" }],
    }, "KJV")
    expect(render.highlights).toEqual([
      { segmentIndex: 0, start: 0, end: 3, color: "#FACC15", sourceText: "The" },
    ])
  })
  it("returns null when live output is off", () => {
    const result = deriveLiveVerse({
      isLive: false,
      selectedVerse: sampleVerse,
      translation: "NKJV",
    })

    expect(result).toBeNull()
  })

  it("returns verse render data when live output is on", () => {
    const result = deriveLiveVerse({
      isLive: true,
      selectedVerse: sampleVerse,
      translation: "NKJV",
    })

    expect(result).toEqual(
      expect.objectContaining({
        reference: "Genesis 1:2 (NKJV)",
      }),
    )
  })
})
