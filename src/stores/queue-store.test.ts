import { beforeEach, describe, expect, it } from "vitest"
import { useQueueStore } from "./queue-store"
import { useSettingsStore } from "./settings-store"
import type { QueueItem, Verse } from "@/types"

const longVerse: Verse = {
  id: 1,
  translation_id: 1,
  book_number: 43,
  book_name: "John",
  book_abbreviation: "John",
  chapter: 3,
  verse: 16,
  text:
    "First sentence has enough words for the opening slide and gives the operator a readable portion before moving forward. " +
    "Second sentence also carries enough words to become another slide while keeping the projected text comfortable and calm. " +
    "Third sentence rounds out the passage with a final readable chunk for the congregation to follow clearly.",
}

function queueVerse(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    kind: "verse",
    id: "q-1",
    source: "manual",
    added_at: 1,
    verse: longVerse,
    reference: "John 3:16",
    confidence: 1,
    ...overrides,
  } as QueueItem
}

describe("queue-store long verse splitting", () => {
  beforeEach(() => {
    useQueueStore.setState({ items: [], activeIndex: null })
    useSettingsStore.setState({
      autoSplitLongVerses: true,
      splitWordThreshold: 20,
    })
  })

  it("expands long verse items into grouped chunk slides when enabled", () => {
    useQueueStore.getState().addItem(queueVerse())

    const items = useQueueStore.getState().items
    expect(items.length).toBeGreaterThan(1)
    expect(items.every((item) => item.kind === "verse" && item.chunk)).toBe(true)

    const groupIds = new Set(
      items.map((item) => item.kind === "verse" ? item.chunk?.groupId : null),
    )
    expect(groupIds.size).toBe(1)
    expect(items.map((item) => item.reference)).toEqual([
      "John 3:16 (1/3)",
      "John 3:16 (2/3)",
      "John 3:16 (3/3)",
    ])
  })

  it("keeps long verse as a single queue item when disabled", () => {
    useSettingsStore.setState({ autoSplitLongVerses: false })

    useQueueStore.getState().addItem(queueVerse())

    expect(useQueueStore.getState().items).toEqual([queueVerse()])
  })

  it("updates highlights only on the addressed queue item", () => {
    useSettingsStore.setState({ autoSplitLongVerses: false })
    useQueueStore.getState().addItem(queueVerse({ id: "q-1" }))
    useQueueStore.getState().addItem(queueVerse({ id: "q-2" }))

    useQueueStore.getState().updateVerseHighlights("q-1", [
      { segmentIndex: 0, start: 0, end: 5, color: "#FACC15", sourceText: "First" },
    ])

    const [first, second] = useQueueStore.getState().items
    expect(first.kind === "verse" ? first.highlights : undefined).toHaveLength(1)
    expect(second.kind === "verse" ? second.highlights : undefined).toBeUndefined()
    expect(first.kind === "verse" ? first.verse.text : "").toBe(longVerse.text)
  })
})
