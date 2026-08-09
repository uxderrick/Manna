import { describe, expect, it } from "vitest"
import type { QueueItem, Verse } from "@/types"
import {
  findAdjacentBibleVerse,
  shouldStepWithinQueue,
} from "./broadcast-navigation"

const verse: Verse = {
  id: 3016,
  translation_id: 1,
  book_number: 43,
  book_name: "John",
  book_abbreviation: "Jn",
  chapter: 3,
  verse: 16,
  text: "For God so loved the world.",
}

describe("shouldStepWithinQueue", () => {
  it("lets ordinary Bible verses step to adjacent scripture", () => {
    const item: QueueItem = {
      kind: "verse",
      id: "verse-1",
      source: "manual",
      added_at: 1,
      verse,
      reference: "John 3:16",
      confidence: 1,
    }

    expect(shouldStepWithinQueue(item)).toBe(false)
  })

  it("keeps split verse slides within their queue group", () => {
    const item: QueueItem = {
      kind: "verse",
      id: "verse-chunk-1",
      source: "manual",
      added_at: 1,
      verse,
      reference: "John 3:16 (1/2)",
      confidence: 1,
      chunk: {
        groupId: "john-3-16",
        index: 1,
        total: 2,
        text: "For God so loved",
      },
    }

    expect(shouldStepWithinQueue(item)).toBe(true)
  })

  it("keeps song stanzas within the queue", () => {
    const item = {
      kind: "song-stanza",
      id: "song-1-v1",
      source: "manual",
      added_at: 1,
      songId: "song-1",
      stanzaId: "verse-1",
      reference: "Amazing Grace · Verse 1",
    } as QueueItem

    expect(shouldStepWithinQueue(item)).toBe(true)
  })

  it("ignores a stale active queue item when another scripture is displayed", () => {
    const item = {
      kind: "song-stanza",
      id: "song-1-v1",
      source: "manual",
      added_at: 1,
      songId: "song-1",
      stanzaId: "verse-1",
      reference: "Amazing Grace · Verse 1",
    } as QueueItem

    expect(
      shouldStepWithinQueue(item, "John 3:16 (KJV)", "Amazing Grace · Verse 1")
    ).toBe(false)
  })
})

describe("findAdjacentBibleVerse", () => {
  it("moves Next from the final verse into the next chapter", async () => {
    const nextChapterVerse = { ...verse, chapter: 4, verse: 1, id: 4001 }

    const result = await findAdjacentBibleVerse({
      bookNumber: 43,
      chapter: 3,
      verse: 36,
      direction: 1,
      maxChapter: 21,
      fetchVerse: async ({ chapter, verse: verseNumber }) =>
        chapter === 4 && verseNumber === 1 ? nextChapterVerse : null,
      fetchChapter: async () => [],
    })

    expect(result).toEqual(nextChapterVerse)
  })

  it("moves Prev from verse one to the final verse of the previous chapter", async () => {
    const previousChapterLastVerse = {
      ...verse,
      chapter: 2,
      verse: 25,
      id: 2025,
    }

    const result = await findAdjacentBibleVerse({
      bookNumber: 43,
      chapter: 3,
      verse: 1,
      direction: -1,
      maxChapter: 21,
      fetchVerse: async () => null,
      fetchChapter: async ({ chapter }) =>
        chapter === 2
          ? [{ ...verse, chapter: 2, verse: 1 }, previousChapterLastVerse]
          : [],
    })

    expect(result).toEqual(previousChapterLastVerse)
  })
})
