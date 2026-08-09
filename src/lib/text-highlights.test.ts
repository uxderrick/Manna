import { describe, expect, it } from "vitest"
import {
  DEFAULT_HIGHLIGHT_COLOR,
  applyHighlight,
  clearHighlightRange,
  normalizeHighlightColor,
  rangeFromWordHits,
  validHighlights,
} from "./text-highlights"
import type { TextHighlight, WordHitBox } from "@/types"

const text = "For God so loved the world"

describe("text highlights", () => {
  it("drops ranges that no longer match their source text", () => {
    expect(validHighlights(text, [
      { segmentIndex: 0, start: 4, end: 7, color: "#FACC15", sourceText: "God" },
      { segmentIndex: 0, start: 8, end: 10, color: "#FACC15", sourceText: "xx" },
      { segmentIndex: 0, start: 99, end: 100, color: "#FACC15", sourceText: "x" },
    ])).toEqual([
      { segmentIndex: 0, start: 4, end: 7, color: "#FACC15", sourceText: "God" },
    ])
  })

  it("lets the newest color replace only its overlapping range", () => {
    const existing: TextHighlight[] = [
      { segmentIndex: 0, start: 0, end: 16, color: "#FACC15", sourceText: "For God so loved" },
    ]

    expect(applyHighlight(text, existing, {
      segmentIndex: 0,
      start: 4,
      end: 10,
      color: "#4ADE80",
      sourceText: "God so",
    })).toEqual([
      { segmentIndex: 0, start: 0, end: 4, color: "#FACC15", sourceText: "For " },
      { segmentIndex: 0, start: 4, end: 10, color: "#4ADE80", sourceText: "God so" },
      { segmentIndex: 0, start: 10, end: 16, color: "#FACC15", sourceText: " loved" },
    ])
  })

  it("clears only the selected portion", () => {
    expect(clearHighlightRange(text, [
      { segmentIndex: 0, start: 0, end: 16, color: "#FACC15", sourceText: "For God so loved" },
    ], { segmentIndex: 0, start: 4, end: 10 })).toEqual([
      { segmentIndex: 0, start: 0, end: 4, color: "#FACC15", sourceText: "For " },
      { segmentIndex: 0, start: 10, end: 16, color: "#FACC15", sourceText: " loved" },
    ])
  })

  it("resolves a reverse drag in source order", () => {
    const hits: WordHitBox[] = [
      { segmentIndex: 0, start: 0, end: 3, x: 0, y: 0, width: 30, height: 20 },
      { segmentIndex: 0, start: 4, end: 7, x: 40, y: 0, width: 30, height: 20 },
      { segmentIndex: 0, start: 8, end: 10, x: 80, y: 0, width: 20, height: 20 },
    ]
    expect(rangeFromWordHits(hits[2], hits[0])).toEqual({ segmentIndex: 0, start: 0, end: 10 })
  })

  it("accepts only palette colors", () => {
    expect(normalizeHighlightColor("#4ade80")).toBe("#4ADE80")
    expect(normalizeHighlightColor("transparent")).toBe(DEFAULT_HIGHLIGHT_COLOR)
    expect(normalizeHighlightColor("#000000")).toBe(DEFAULT_HIGHLIGHT_COLOR)
  })
})
