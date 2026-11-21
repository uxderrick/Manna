import { setChurchAssets } from "@/lib/church-assets"
import { beforeEach as beforePrivatePack } from "vitest"
beforePrivatePack(() => setChurchAssets({ "/service-slides/pastor-john-kennedy-starburst.png": "/managed/portrait.png", "/EWC-White.png": "/managed/logo.png" }))
import { expect, it, vi } from "vitest"
import { drawImageSlide } from "./image-slide-renderer"
import type { ImageSlide } from "@/types"
function context() {
  const draws: string[] = []
  const ctx = {
    font: "",
    globalAlpha: 1,
    save() {},
    restore() {},
    fillRect() {},
    drawImage() {},
    measureText(text: string) {
      return {
        width:
          Array.from(text).length *
          parseFloat(this.font.match(/([\d.]+)px/)?.[1] ?? "20") *
          0.55,
      }
    },
    fillText(text: string) {
      if (this.globalAlpha === 1) draws.push(text)
    },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, draws }
}
const slide: ImageSlide = {
  url: "/background.png",
  label: "Title",
  textOverlay: { layout: "title", title: "JOHN DOE", body: "LEAD PASTOR" },
}
it("renders editable title text with the approved grotesk spacing and directional trail", () => {
  const { ctx } = context()
  const passes: Array<{
    text: string
    x: number
    y: number
    alpha: number
    font: string
    spacing: string
    shadowBlur: number
    shadowColor: string
  }> = []
  ctx.fillText = (text, x, y) =>
    passes.push({
      text,
      x,
      y,
      alpha: ctx.globalAlpha,
      font: ctx.font,
      spacing: ctx.letterSpacing,
      shadowBlur: ctx.shadowBlur,
      shadowColor: ctx.shadowColor,
    })
  const words = { layout: "title" as const, title: "Living by faith", body: "" }
  const original = JSON.stringify(words)
  const lines = drawImageSlide(
    ctx,
    undefined,
    { ...slide, textOverlay: words },
    1920,
    1080
  )
  const core = passes.filter((pass) => pass.alpha === 1)
  const trails = passes.filter((pass) => pass.alpha < 1)
  expect(core.map((pass) => pass.text)).toEqual(["LIVING BY FAITH"])
  expect(core[0].font).toMatch(/^700 /)
  expect(core[0].shadowBlur).toBeCloseTo(1920 * (6 / 720))
  expect(core[0].shadowColor).toBe("rgba(236, 223, 193, 0.48)")
  expect(parseFloat(core[0].spacing)).toBeCloseTo(-lines[0].fontSize * 0.055)
  expect(trails.length).toBeGreaterThan(0)
  expect(trails.some((pass) => pass.x > core[0].x)).toBe(true)
  expect(trails.every((pass) => pass.y === core[0].y)).toBe(true)
  expect(JSON.stringify(words)).toBe(original)
})

it("scales the title trail with the artwork and leaves speaker names and announcements clean", () => {
  const render = (
    width: number,
    layout: "title" | "announcement" = "title"
  ) => {
    const { ctx } = context()
    const passes: Array<{ text: string; x: number; alpha: number }> = []
    ctx.fillText = (text, x) => passes.push({ text, x, alpha: ctx.globalAlpha })
    drawImageSlide(
      ctx,
      undefined,
      {
        ...slide,
        textOverlay: { layout, title: "Faith", body: "Pastor Jane" },
      },
      width,
      (width * 9) / 16
    )
    return passes
  }
  const full = render(1920)
  const panel = render(480)
  const fullTrail = full.filter((pass) => pass.alpha < 1)
  const panelTrail = panel.filter((pass) => pass.alpha < 1)
  expect(fullTrail.length).toBeGreaterThan(0)
  expect(fullTrail.every((pass) => pass.text === "FAITH")).toBe(true)
  expect(panelTrail).toHaveLength(fullTrail.length)
  fullTrail.forEach((pass, i) =>
    expect(panelTrail[i].x).toBeCloseTo(pass.x / 4)
  )
  expect(render(1920, "announcement").every((pass) => pass.alpha === 1)).toBe(
    true
  )
})
it("draws editable words instead of baking them into the background", () => {
  const { ctx, draws } = context()
  drawImageSlide(ctx, undefined, slide, 1920, 1080)
  expect(draws).toEqual(["JOHN DOE", "LEAD", "PASTOR"])
})
it("fits long announcements above the starburst without dropping words", () => {
  const { ctx, draws } = context()
  const title = "Church family gathering this coming Sunday"
  const body =
    "Everyone is welcome to join us after the morning service for fellowship and refreshments. Bring your family and invite a friend."
  const lines = drawImageSlide(
    ctx,
    undefined,
    { ...slide, textOverlay: { layout: "announcement", title, body } },
    1920,
    1080
  )
  expect(draws.join(" ")).toBe(`${title} ${body}`.toUpperCase())
  expect(lines.every((line) => line.y + line.lineHeight <= 1080 * 0.54)).toBe(
    true
  )
})
it("scales the same layout for the On Screen panel and projector", () => {
  const full = drawImageSlide(context().ctx, undefined, slide, 1920, 1080)
  const small = drawImageSlide(context().ctx, undefined, slide, 480, 270)
  expect(full.length).toBeGreaterThan(0)
  expect(small.map((line) => line.text)).toEqual(full.map((line) => line.text))
  expect(small[0]?.fontSize).toBeCloseTo(full[0]?.fontSize / 4)
  expect(small[0]?.y).toBeCloseTo(full[0]?.y / 4)
})
it("keeps old image-only slides free of text", () => {
  const { ctx, draws } = context()
  drawImageSlide(ctx, undefined, { url: "/old.png", label: "Old" }, 1920, 1080)
  expect(draws).toEqual([])
})

it("uses bold capitals and tight spacing without changing saved words", () => {
  const { ctx, draws } = context()
  const textOverlay = {
    layout: "title" as const,
    title: "Sunday service",
    body: "Pastor Example",
  }
  const lines = drawImageSlide(
    ctx,
    undefined,
    { ...slide, textOverlay },
    1920,
    1080
  )
  expect(draws).toEqual(["SUNDAY SERVICE", "PASTOR", "EXAMPLE"])
  expect(ctx.font).toMatch(/^400 /)
  expect(parseFloat(ctx.letterSpacing)).toBeCloseTo(
    -lines.at(-1)!.fontSize * 0.035
  )
  expect(lines[0].lineHeight).toBeCloseTo(lines[0].fontSize * 1.02)
  expect(textOverlay.title).toBe("Sunday service")
})

it("keeps long prayer text beside the background artwork at full and panel sizes", () => {
  const body =
    "Father, strengthen our families and help us care for each other. "
      .repeat(4)
      .trim()
  const prayer: ImageSlide = {
    url: "/prayer.png",
    label: "Prayer",
    textOverlay: { layout: "prayer", title: "PRAYER", body },
  }
  const full = drawImageSlide(context().ctx, undefined, prayer, 1920, 1080)
  const small = drawImageSlide(context().ctx, undefined, prayer, 480, 270)
  expect(full.map((line) => line.text).join(" ")).toBe(body.toUpperCase())
  expect(
    full.every(
      (line) => line.y >= 1080 * 0.15 && line.y + line.lineHeight <= 1080 * 0.85
    )
  ).toBe(true)
  expect(full.every((line) => line.x < 1920 * 0.1 && line.fontSize >= 56)).toBe(
    true
  )
  expect(small.map((line) => line.text)).toEqual(full.map((line) => line.text))
  expect(small[0].fontSize).toBeCloseTo(full[0].fontSize / 4)
})

it("anchors one speaker word per line at the bottom left at a smaller fixed size", () => {
  const lines = drawImageSlide(
    context().ctx,
    undefined,
    {
      ...slide,
      textOverlay: {
        layout: "title",
        title: "Living by faith",
        body: "Pastor John",
      },
    },
    1920,
    1080
  )
  const title = lines.filter((line) => line.align !== "left")
  const speaker = lines.filter((line) => line.align === "left")
  expect(speaker.map((line) => line.text)).toEqual(["PASTOR", "JOHN"])
  expect(lines.find((line) => line.align === "left")!.fontSize).toBeCloseTo(
    1920 * 0.049 * 0.9
  )
  expect(speaker[0].x).toBeCloseTo(1920 * 0.08)
  expect(speaker.at(-1)!.y + speaker.at(-1)!.lineHeight).toBeCloseTo(
    1080 * 0.94
  )
  expect(speaker[0].y).toBeGreaterThan(
    title.at(-1)!.y + title.at(-1)!.lineHeight
  )
})
it("keeps the speaker size fixed when a long title shrinks", () => {
  const body = "Pastor Bartholomew Alexander Montgomery"
  const lines = drawImageSlide(
    context().ctx,
    undefined,
    {
      ...slide,
      textOverlay: {
        layout: "title",
        title:
          "The promise of hope and faith through every season of our lives and the strength to stay faithful when the road ahead feels uncertain",
        body,
      },
    },
    1920,
    1080
  )
  expect(lines.find((line) => line.align === "left")!.fontSize).toBeCloseTo(
    1920 * 0.049 * 0.9
  )
  const short = drawImageSlide(
    context().ctx,
    undefined,
    { ...slide, textOverlay: { layout: "title", title: "Hope", body } },
    1920,
    1080
  )
  expect(lines[0].fontSize).toBeLessThan(short[0].fontSize)
  expect(lines.find((line) => line.align === "left")!.fontSize).toBe(
    short.find((line) => line.align === "left")!.fontSize
  )
  expect(
    lines.filter((line) => line.align === "left").map((line) => line.text)
  ).toEqual(body.toUpperCase().split(" "))
  expect(
    lines.every(
      (line) => line.y >= 0 && line.y + line.lineHeight <= 1080 * 0.94
    )
  ).toBe(true)
})

it("uses the approved full background, hides its speaker name, and keeps the title editable", () => {
  const { ctx } = context()
  const draw = vi.spyOn(ctx, "drawImage")
  const portrait = {
    complete: true,
    naturalWidth: 1024,
    naturalHeight: 1024,
  } as HTMLImageElement
  const titleSlide: ImageSlide = {
    ...slide,
    textOverlay: {
      layout: "title",
      title: "Living by faith",
      body: "Pastor John Kennedy",
    },
  }
  const words = drawImageSlide(ctx, undefined, titleSlide, 1920, 1080, portrait)
  expect(draw).toHaveBeenCalledOnce()
  expect(draw.mock.calls[0][0]).toBe(portrait)
  expect(
    words.filter((line) => line.align === "left").map((line) => line.text)
  ).toEqual([])
  expect(words.map((line) => line.text)).toEqual(["LIVING BY FAITH"])
  expect(draw.mock.calls[0].slice(1)).toEqual([0, 0, 1920, 1080])
  draw.mockClear()
  drawImageSlide(
    ctx,
    undefined,
    {
      ...titleSlide,
      textOverlay: { ...titleSlide.textOverlay!, body: "Pastor Jane" },
    },
    1920,
    1080,
    portrait
  )
  expect(draw).not.toHaveBeenCalled()
})

it("keeps prayer typography and white text unchanged when title styling changes", () => {
  const title = drawImageSlide(
    context().ctx,
    undefined,
    { ...slide, textOverlay: { layout: "title", title: "Pray", body: "" } },
    1920,
    1080
  )
  const { ctx } = context()
  const styles: Array<{
    text: string
    font: string
    color: string | CanvasGradient | CanvasPattern
    spacing: string
  }> = []
  ctx.fillText = (text) => {
    styles.push({
      text,
      font: ctx.font,
      color: ctx.fillStyle,
      spacing: ctx.letterSpacing,
    })
  }
  const overlay = { layout: "prayer" as const, title: "PRAYER", body: "Pray" }
  const prayer = drawImageSlide(
    ctx,
    undefined,
    { ...slide, textOverlay: overlay },
    1920,
    1080
  )
  expect(prayer[0].fontSize).toBeCloseTo(1920 * 0.098)
  expect(prayer[0].lineHeight).toBeCloseTo(prayer[0].fontSize * 1.02)
  expect(title[0].fontSize).toBeLessThan(prayer[0].fontSize)
  const body = styles.find((style) => style.text === "PRAY")!
  expect(body.font).toMatch(/^600 /)
  expect(body.color).toBe("#ffffff")
  expect(parseFloat(body.spacing)).toBeCloseTo(-prayer[0].fontSize * 0.035)
  expect(overlay.body).toBe("Pray")
})

it("centers only the EWC symbol at the bottom of the portrait artwork", () => {
  const { ctx } = context()
  const draw = vi.spyOn(ctx, "drawImage")
  const portrait = {
    complete: true,
    naturalWidth: 1920,
    naturalHeight: 1080,
  } as HTMLImageElement
  const mark = {
    complete: true,
    naturalWidth: 7000,
    naturalHeight: 1508,
  } as HTMLImageElement
  const titleSlide: ImageSlide = {
    ...slide,
    textOverlay: {
      layout: "title",
      title: "Faith",
      body: "Pastor John Kennedy",
    },
  }
  drawImageSlide(ctx, undefined, titleSlide, 1920, 1080, portrait, mark)
  expect(draw).toHaveBeenCalledTimes(2)
  const call = draw.mock.calls[1]
  expect(call.slice(0, 5)).toEqual([mark, 0, 0, 1508, 1508])
  const [x, y, width, height] = call.slice(5) as number[]
  expect(x + width / 2).toBeCloseTo(960)
  expect(y + height).toBeCloseTo(1080 * 0.978)
  expect(width).toBeCloseTo(1080 * 0.065)
  draw.mockClear()
  drawImageSlide(
    ctx,
    undefined,
    {
      ...titleSlide,
      textOverlay: { ...titleSlide.textOverlay!, body: "Pastor Jane" },
    },
    1920,
    1080,
    portrait,
    mark
  )
  expect(draw).not.toHaveBeenCalled()
})
