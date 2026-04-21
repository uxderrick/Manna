// src/components/service-plan/activation-router.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest"

import { activatePlanItem } from "./activation-router"
import type { PlanItem } from "@/types"

const setLiveVerse = vi.fn()

vi.mock("@/stores", () => ({
  useBroadcastStore: {
    getState: () => ({
      setLiveVerse,
    }),
  },
  useBibleStore: {
    getState: () => ({
      activeTranslationId: 1,
      translations: [{ id: 1, abbreviation: "KJV" }],
    }),
  },
}))

function mkItem(itemType: PlanItem["itemType"], data: unknown): PlanItem {
  return {
    id: 1,
    planId: 1,
    planKind: "session",
    orderIndex: 1,
    itemType,
    itemData: JSON.stringify(data),
    autoAdvanceSeconds: null,
  }
}

describe("activation router", () => {
  beforeEach(() => {
    setLiveVerse.mockReset()
  })

  it("section items are no-op", () => {
    activatePlanItem(mkItem("section", { label: "Worship" }))
    expect(setLiveVerse).not.toHaveBeenCalled()
  })

  it("blank item clears live", () => {
    activatePlanItem(mkItem("blank", { showLogo: false }))
    expect(setLiveVerse).toHaveBeenCalledWith(null)
  })

  it("verse item routes to setLiveVerse", () => {
    const item = mkItem("verse", {
      verseRef: "John 3:16",
      translationId: 1,
      verseText: "For God so loved the world",
      bookNumber: 43,
      chapter: 3,
      verse: 16,
      bookName: "John",
    })
    activatePlanItem(item)
    expect(setLiveVerse).toHaveBeenCalledTimes(1)
    const arg = setLiveVerse.mock.calls[0][0]
    expect(arg).not.toBeNull()
    expect(arg.reference).toContain("John 3:16")
    expect(arg.segments[0].text).toBe("For God so loved the world")
  })

  it("corrupt JSON renders as blank clear", () => {
    const item: PlanItem = {
      id: 9,
      planId: 1,
      planKind: "session",
      orderIndex: 1,
      itemType: "blank",
      itemData: "{not json",
      autoAdvanceSeconds: null,
    }
    activatePlanItem(item)
    expect(setLiveVerse).toHaveBeenCalledWith(null)
  })
})
