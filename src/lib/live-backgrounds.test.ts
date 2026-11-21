import { afterEach, describe, expect, it, vi } from "vitest"
import { BUILTIN_THEMES } from "./builtin-themes"
import { parseBroadcastTheme } from "./broadcast-theme"
import {
  BACKGROUND_MEDIA,
  withLiveBackground,
  backgroundContext,
  loadBackgroundChoices,
  saveBackgroundChoices,
} from "./live-backgrounds"

afterEach(() => vi.unstubAllGlobals())

describe("live backgrounds", () => {
  it("keeps the original theme when Theme default is selected", () => {
    expect(
      withLiveBackground(BUILTIN_THEMES[0], { id: null, dimming: 0.25 })
    ).toBe(BUILTIN_THEMES[0])
  })

  it("changes only background settings and retains valid theme typography", () => {
    const original = BUILTIN_THEMES[0]
    const result = withLiveBackground(original, {
      id: "aurora-cool",
      dimming: 0.4,
    })
    expect(result.background.type).toBe("video")
    expect(result.background.video?.url).toContain("aurora-cool.mp4")
    expect(result.background.video?.dimming).toBe(0.4)
    expect(result.verseText).toBe(original.verseText)
    expect(result.layout).toBe(original.layout)
    expect(parseBroadcastTheme(result).background).toEqual(result.background)
    expect(original.background.type).not.toBe("video")
  })

  it("supports still images and identifies songs separately", () => {
    expect(BACKGROUND_MEDIA.filter((x) => x.kind === "video")).toHaveLength(13)
    expect(
      withLiveBackground(BUILTIN_THEMES[0], {
        id: "still-waters",
        dimming: 0.2,
      }).background.type
    ).toBe("image")
    expect(
      backgroundContext({
        reference: "Song",
        hideReference: true,
        segments: [],
      })
    ).toBe("song")
    expect(backgroundContext(null)).toBe("scripture")
  })

  it("rejects malformed video themes", () => {
    const theme = withLiveBackground(BUILTIN_THEMES[0], {
      id: "aurora-cool",
      dimming: 0.2,
    })
    expect(() =>
      parseBroadcastTheme({
        ...theme,
        background: {
          ...theme.background,
          video: { url: "javascript:alert(1)", dimming: 0.2 },
        },
      })
    ).toThrow()
    expect(() =>
      parseBroadcastTheme({
        ...theme,
        background: {
          ...theme.background,
          video: { url: "/loop.mp4", dimming: NaN },
        },
      })
    ).toThrow()
  })

  it("restores choices after restart and ignores invalid saved entries", () => {
    const getItem = vi
      .fn()
      .mockReturnValue(
        JSON.stringify({
          scripture: { id: "aurora-cool", dimming: 0.3 },
          song: { id: "removed", dimming: -1 },
        })
      )
    const setItem = vi.fn()
    vi.stubGlobal("localStorage", { getItem, setItem })
    const choices = loadBackgroundChoices()
    expect(choices.scripture).toEqual({ id: "aurora-cool", dimming: 0.3 })
    expect(choices.song).toEqual({ id: null, dimming: 0.25 })
    saveBackgroundChoices(choices)
    expect(setItem).toHaveBeenCalledWith(
      "manna-live-backgrounds",
      JSON.stringify(choices)
    )
    getItem.mockReturnValue("broken json")
    expect(loadBackgroundChoices().scripture.id).toBeNull()
  })
})
