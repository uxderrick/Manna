import { describe, expect, it } from "vitest"
import { BUILTIN_THEMES } from "./builtin-themes"
import { computeVerseLayoutMetrics } from "./verse-renderer"
import type { BroadcastTheme, VerseRenderData } from "@/types"

function measureContext(): CanvasRenderingContext2D {
  return {
    save: () => {},
    restore: () => {},
    measureText: (text: string) => ({ width: text.length * 24 }),
  } as unknown as CanvasRenderingContext2D
}

const verse: VerseRenderData = {
  reference: "John 3:16 (KJV)",
  segments: [{ verseNumber: 16, text: "For God so loved the world." }],
}

describe("verse renderer layout", () => {
  it("maps rendered words back to source offsets and highlight geometry", () => {
    const highlighted: VerseRenderData = {
      ...verse,
      highlights: [
        { segmentIndex: 0, start: 4, end: 7, color: "#FACC15", sourceText: "God" },
      ],
    }

    const metrics = computeVerseLayoutMetrics(
      measureContext(),
      BUILTIN_THEMES[0],
      highlighted,
      { collectWordHits: true },
    )

    expect(metrics.wordHits.map(({ start, end }) => ({ start, end }))).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
      { start: 8, end: 10 },
      { start: 11, end: 16 },
      { start: 17, end: 20 },
      { start: 21, end: 27 },
    ])
    expect(metrics.highlightRects).toHaveLength(1)
    expect(metrics.highlightRects[0].color).toBe("#FACC15")
  })

  it.each(["center-left", "center-right"] as const)(
    "computes finite layout metrics for %s anchor",
    (anchor) => {
      const theme: BroadcastTheme = {
        ...BUILTIN_THEMES[0],
        layout: {
          ...BUILTIN_THEMES[0].layout,
          anchor,
        },
      }

      const metrics = computeVerseLayoutMetrics(measureContext(), theme, verse)

      expect(Number.isFinite(metrics.textAreaRect.x)).toBe(true)
      expect(Number.isFinite(metrics.textAreaRect.y)).toBe(true)
      expect(Number.isFinite(metrics.textRect.x)).toBe(true)
      expect(Number.isFinite(metrics.textRect.y)).toBe(true)
    },
  )
})
