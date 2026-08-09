import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Verse } from "@/types"
import { useBibleStore, useBroadcastStore, useQueueStore } from "@/stores"
import { presentQueuedVerseLive } from "./queue-verse"

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(true),
}))

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}))

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

describe("presentQueuedVerseLive", () => {
  beforeEach(() => {
    useBibleStore.setState({
      translations: [
        {
          id: 1,
          name: "King James Version",
          abbreviation: "KJV",
          language: "English",
        },
      ],
      activeTranslationId: 1,
      selectedVerse: null,
      pendingNavigation: null,
    })
    useQueueStore.setState({ items: [], activeIndex: null })
    useBroadcastStore.setState({
      previewVerse: null,
      liveVerse: null,
      isLive: false,
    })
  })

  it("moves the Bible panel to the verse that goes live", () => {
    presentQueuedVerseLive(verse)

    expect(useBibleStore.getState().selectedVerse).toEqual(verse)
    expect(useBibleStore.getState().pendingNavigation).toEqual({
      bookNumber: 43,
      chapter: 3,
      verse: 16,
    })
    expect(useBroadcastStore.getState().liveVerse?.reference).toBe(
      "John 3:16 (KJV)"
    )
  })
})
