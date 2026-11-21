import { describe, expect, it, vi } from "vitest"
import { withLiveBackground } from "./live-backgrounds"
import { BUILTIN_THEMES } from "./builtin-themes"
import { computeVerseLayoutMetrics, renderVerse } from "./verse-renderer"
function context() {
  const draws: Array<{
    text: string
    font: string
    color: string
    spacing: string
    y: number
  }> = []
  const fills: number[][] = []
  const state = { font: "12px Arial", fillStyle: "#000", letterSpacing: "0px" }
  const stack: Record<string, unknown>[] = []
  const ctx = new Proxy(
    {
      ...state,
      save() {
        stack.push({
          font: this.font,
          fillStyle: this.fillStyle,
          letterSpacing: this.letterSpacing,
        })
      },
      restore() {
        Object.assign(this, stack.pop())
      },
      measureText(text: string) {
        return {
          width:
            text.length *
            (Number(String(this.font).match(/([\d.]+)px/)?.[1] ?? 12) / 2 +
              parseFloat(String(this.letterSpacing))),
        }
      },
      fillText(text: string, _x: number, y: number) {
        draws.push({
          text,
          font: String(this.font),
          color: String(this.fillStyle),
          spacing: String(this.letterSpacing),
          y,
        })
      },
      fillRect(...values: number[]) {
        fills.push(values)
      },
    },
    { get: (t, k) => Reflect.get(t, k) ?? (() => {}) }
  ) as unknown as CanvasRenderingContext2D
  return { ctx, draws, fills }
}
const verse = {
  reference: "John 3:16 (KJV)",
  segments: [{ verseNumber: 16, text: "For God so loved the world." }],
}
const theme = () => {
  const t = structuredClone(BUILTIN_THEMES[1])
  t.logo = null
  return t
}
describe("theme rendering controls", () => {
  it("paints decoded video beneath readable scripture and uses a still poster while loading", () => {
    const t = withLiveBackground(theme(), { id: "aurora-cool", dimming: 0.25 })
    const { ctx, draws } = context()
    const drawImage = vi.fn()
    ctx.drawImage = drawImage
    const video = { readyState: 2, videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement
    expect(renderVerse(ctx, t, verse, { backgroundVideo: video })).not.toBeNull()
    expect(drawImage.mock.calls[0][0]).toBe(video)
    expect(draws.some((draw) => draw.text.includes("For"))).toBe(true)
    drawImage.mockClear()
    const poster = { complete: true, naturalWidth: 1920, naturalHeight: 1080 } as HTMLImageElement
    renderVerse(ctx, t, verse, { imageCache: new Map([[t.background.video!.poster!, poster]]) })
    expect(drawImage.mock.calls[0][0]).toBe(poster)
  })
  it("hides song titles without reserving reference space", () => {
    const t = theme()
    t.reference.standalone = null
    t.verseText.autoFit = false
    const song = { ...verse, hideReference: true }
    const { ctx, draws } = context()
    const metrics = renderVerse(ctx, t, song)!
    expect(metrics.referenceRect).toBeNull()
    expect(draws.some((d) => d.text.includes("JOHN"))).toBe(false)
    expect(metrics.verseRect!.y).toBeCloseTo(
      metrics.textRect.y +
        (metrics.textRect.height - metrics.verseRect!.height) / 2
    )
  })
  it("places a reference at top center", () => {
    const t = theme()
    t.reference.standalone = { anchor: "top-center", margin: 60 }
    const { ctx } = context()
    const metrics = computeVerseLayoutMetrics(ctx, t, verse)
    expect(metrics.referenceRect!.x + metrics.referenceRect!.width / 2).toBe(
      960
    )
    expect(metrics.referenceRect!.y).toBe(60)
  })
  it("renders verse number size, color and superscript separately", () => {
    const t = theme()
    t.verseNumbers = {
      visible: true,
      fontSize: 20,
      color: "#ff0000",
      superscript: true,
    }
    const { ctx, draws } = context()
    renderVerse(ctx, t, verse)
    const number = draws.find((d) => d.text === "16")!
    expect(number?.font).toContain("20px")
    expect(number?.color).toBe("#ff0000")
    expect(number?.y).toBeLessThan(draws.find((d) => d.text.includes("For"))!.y)
  })
  it("applies negative tracking and measures reference tracking", () => {
    const t = theme()
    t.verseText.letterSpacing = -3
    t.verseText.autoFit = false
    const { ctx, draws } = context()
    const m = renderVerse(ctx, t, verse)!
    expect(draws.find((d) => d.text.includes("For"))?.spacing).toBe("-3px")
    expect(m.referenceRect!.width).toBe(
      verse.reference.length *
        (t.reference.fontSize / 2 + t.reference.letterSpacing)
    )
  })
  it("scales reference gaps and image blur in previews", () => {
    const t = theme()
    t.reference.standalone = null
    t.verseText.autoFit = false
    t.verseText.verticalAlign = "top"
    const { ctx } = context()
    const full = computeVerseLayoutMetrics(ctx, t, verse),
      small = computeVerseLayoutMetrics(ctx, t, verse, { scale: 0.25 })
    const gap = (m: typeof full) =>
      m.referenceRect!.y - m.verseRect!.y - m.verseRect!.height
    expect(gap(small)).toBeCloseTo(gap(full) * 0.25)
    t.background.image!.blur = 12
    expect(
      computeVerseLayoutMetrics(ctx, t, null, { scale: 0.25 }).scaledTheme
        .background.image!.blur
    ).toBe(3)
  })
  it("uses text box padding and never returns negative text dimensions", () => {
    const t = theme()
    t.textBox.enabled = true
    t.textBox.padding = 80
    const { ctx } = context()
    const a = computeVerseLayoutMetrics(ctx, t, verse)
    t.textBox.padding = 0
    expect(computeVerseLayoutMetrics(ctx, t, verse).textRect.x).toBe(
      a.textRect.x - 80
    )
    t.layout.padding.left = 9999
    expect(
      computeVerseLayoutMetrics(ctx, t, verse).textRect.width
    ).toBeGreaterThan(0)
  })
  it("clears the full image frame before drawing contain", () => {
    const t = theme()
    t.background.image!.fit = "contain"
    const { ctx, fills } = context()
    renderVerse(ctx, t, null, {
      imageCache: new Map([
        [
          t.background.image!.url,
          { naturalWidth: 100, naturalHeight: 100 } as HTMLImageElement,
        ],
      ]),
    })
    expect(fills[0]).toEqual([0, 0, 1920, 1080])
  })
})
