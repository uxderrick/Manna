import { beforeEach, describe, expect, it, vi } from "vitest"
import { hydrateQueue, useQueueStore } from "./queue-store"
import { useBibleStore } from "./bible-store"
import { useSessionStore } from "./session-store"
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
    expect(items.every((item) => item.kind === "verse" && item.chunk)).toBe(
      true
    )

    const groupIds = new Set(
      items.map((item) => (item.kind === "verse" ? item.chunk?.groupId : null))
    )
    expect(groupIds.size).toBe(1)
    expect(items.map((item) => item.kind === "verse" ? item.reference : null)).toEqual([
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

describe("queue-store state replacement", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    })
    useQueueStore.setState({ items: [], activeIndex: null })
    useSessionStore.setState({
      activeSession: { id: 42 } as NonNullable<
        ReturnType<typeof useSessionStore.getState>["activeSession"]
      >,
    })
    vi.mocked(localStorage.setItem).mockClear()
  })

  it("persists replacement items with their active index as one coherent state", () => {
    const items = [queueVerse({ id: "replacement" })]

    useQueueStore.getState().replaceQueueState({ items, activeIndex: 0 })

    expect(useQueueStore.getState()).toMatchObject({ items, activeIndex: 0 })
    expect(localStorage.setItem).toHaveBeenCalledOnce()
    expect(
      JSON.parse(vi.mocked(localStorage.setItem).mock.calls[0][1])
    ).toEqual({
      sessionId: 42,
      items,
      activeIndex: 0,
    })
  })
})

describe("queue hydration presenter restoration", () => {
  beforeEach(() => {
    useQueueStore.setState({ items: [], activeIndex: null })
    useBibleStore.setState({ selectedVerse: null, pendingNavigation: null })
  })

  it("restores the active split scripture into Bible selection and navigation", () => {
    const chunk = queueVerse({
      id: "restored",
      chunk: { groupId: "g", index: 2, total: 3, text: "part two" },
    })
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() =>
        JSON.stringify({ sessionId: 7, items: [chunk], activeIndex: 0 })
      ),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    })

    hydrateQueue(7)

    expect(useBibleStore.getState().selectedVerse).toEqual(longVerse)
    expect(useBibleStore.getState().pendingNavigation).toEqual({
      bookNumber: 43,
      chapter: 3,
      verse: 16,
    })
  })

  it("does not treat a restored active image as scripture", () => {
    const activeImage: QueueItem = {
      kind: "image",
      id: "image",
      source: "manual",
      added_at: 1,
      url: "image.jpg",
      label: "Image",
      provider: "local",
    }
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() =>
        JSON.stringify({ sessionId: 8, items: [activeImage], activeIndex: 0 })
      ),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    })

    hydrateQueue(8)

    expect(useBibleStore.getState().selectedVerse).toBeNull()
    expect(useBibleStore.getState().pendingNavigation).toBeNull()
  })
})

describe("queue active item identity", () => {
  const items: QueueItem[] = ["a", "b", "c", "d"].map(id => ({ kind: "image", id, url: id, label: id, provider: "local", source: "manual", added_at: 1 }))
  beforeEach(() => useQueueStore.setState({ items, activeIndex: 1 }))
  it("keeps the same active item when an earlier item is removed", () => {
    useQueueStore.getState().removeItem("a")
    const q = useQueueStore.getState()
    expect(q.items[q.activeIndex!].id).toBe("b")
  })
  it("clears the pointer when the active item is removed", () => {
    useQueueStore.getState().removeItem("b")
    expect(useQueueStore.getState().activeIndex).toBeNull()
  })
  it("keeps the same active item when another row crosses it", () => {
    useQueueStore.getState().reorderItems(0, 3)
    const q = useQueueStore.getState()
    expect(q.items[q.activeIndex!].id).toBe("b")
  })
  it("follows the active row when it is moved", () => {
    useQueueStore.getState().reorderItems(1, 3)
    expect(useQueueStore.getState().activeIndex).toBe(3)
  })
})

it("keeps video metadata when a loop is queued", () => {
  useQueueStore.setState({ items: [], activeIndex: null })
  useQueueStore.getState().enqueueImage({
    url: "/candle.mp4", label: "Candlelight", thumbnailUrl: "/candle.jpg",
    mediaType: "video", provider: "library",
  })
  expect(useQueueStore.getState().items[0]).toMatchObject({
    kind: "image", url: "/candle.mp4", mediaType: "video", thumbnailUrl: "/candle.jpg",
  })
})

it("retains YouTube link metadata in the queue without downloading a file", () => {
  useQueueStore.setState({items:[],activeIndex:null})
  useQueueStore.getState().enqueueImage({url:"https://www.youtube.com/watch?v=M7lc1UVf-VE",label:"Worship",mediaType:"youtube",provider:"youtube"})
  expect(useQueueStore.getState().items[0]).toMatchObject({kind:"image",mediaType:"youtube",provider:"youtube",url:"https://www.youtube.com/watch?v=M7lc1UVf-VE"})
})
