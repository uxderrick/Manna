import { CLOSING_SLIDE } from "./(lib)/closing-slide"
// src/components/service-plan/activation-router.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest"

import { activatePlanItem } from "./activation-router"
import type { PlanItem } from "@/types"
import { WELCOME_SLIDE, WELCOME_MOTION_SLIDE } from "./(lib)/welcome-slide"
import { JESUS_SLIDES } from "./(lib)/jesus-slides"

const setLiveVerse = vi.fn()
const setBlankLogo = vi.fn()
const setFullscreenImage = vi.fn()
const presentSongLive = vi.fn()

vi.mock("@/stores", () => ({
  useBroadcastStore: {
    getState: () => ({
      setLiveVerse,
      setBlankLogo,
      setFullscreenImage,
    }),
  },
  useBibleStore: {
    getState: () => ({
      activeTranslationId: 1,
      translations: [{ id: 1, abbreviation: "KJV" }],
    }),
  },
  useQueueStore: {
    getState: () => ({
      presentSongLive,
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
    setBlankLogo.mockReset()
    setFullscreenImage.mockReset()
    presentSongLive.mockReset()
  })

  it("section items are no-op", () => {
    activatePlanItem(mkItem("section", { label: "Worship" }))
    expect(setLiveVerse).not.toHaveBeenCalled()
  })

  it("presents the welcome template as a fullscreen image", () => {
    activatePlanItem(mkItem("blank", WELCOME_SLIDE))
    expect(setFullscreenImage).toHaveBeenCalledWith({
      url: "/service-slides/ewc-adenta-welcome.png",
      label: "EWC Adenta — Welcome",
    })
    expect(setLiveVerse).not.toHaveBeenCalled()
    expect(setBlankLogo).not.toHaveBeenCalled()
  })

  it("blank item clears live", () => {
    activatePlanItem(mkItem("blank", { showLogo: false }))
    expect(setLiveVerse).toHaveBeenCalledWith(null)
  })

  it("presents the motion welcome slide as its own image", () => {
    activatePlanItem(mkItem("blank", WELCOME_MOTION_SLIDE))
    expect(setFullscreenImage).toHaveBeenCalledWith({
      url: "/service-slides/welcome-motion.png",
      label: "Welcome — Motion",
    })
  })

  it.each(JESUS_SLIDES)("presents $imageLabel as its own image", (slide) => {
    activatePlanItem(mkItem("blank", slide))
    expect(setFullscreenImage).toHaveBeenCalledWith({
      url: slide.imageUrl,
      label: slide.imageLabel,
    })
    expect(setLiveVerse).not.toHaveBeenCalled()
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


it("presents the approved closing slide", () => {
  setFullscreenImage.mockReset()
  activatePlanItem(mkItem("blank", CLOSING_SLIDE))
  expect(setFullscreenImage).toHaveBeenCalledWith({
    url: "/service-slides/closing-pastor-motion.png",
    label: "Thank You — Closing",
  })
})

it("plays a saved video plan item without scripture or song text", () => {
  setFullscreenImage.mockReset()
  activatePlanItem(mkItem("blank", {
    type: "blank", showLogo: false, imageUrl: "/loop.mp4", imageLabel: "Candlelight",
    mediaType: "video", poster: "/loop.jpg",
  }))
  expect(setFullscreenImage).toHaveBeenCalledWith({
    url: "/loop.mp4", label: "Candlelight", mediaType: "video", poster: "/loop.jpg",
  })
})
