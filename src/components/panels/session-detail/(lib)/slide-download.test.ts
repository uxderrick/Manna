import { setChurchAssets } from "@/lib/church-assets"
import { beforeEach as beforePrivatePack } from "vitest"
beforePrivatePack(() => setChurchAssets({ "/service-slides/pastor-john-kennedy-starburst.png": "/managed/portrait.png", "/EWC-White.png": "/managed/logo.png" }))
import { afterEach, describe, expect, it, vi } from "vitest"
import { downloadSessionSlide, renderSlideJpeg, renderSlidePng } from "./slide-download"

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => `asset:${path}` }))
const save = vi.hoisted(() => vi.fn())
vi.mock("./save-export", () => ({ saveBinaryExport: save }))
vi.mock("@/lib/image-slide-renderer", () => ({ drawImageSlide: vi.fn() }))
import { drawImageSlide } from "@/lib/image-slide-renderer"

function browser({ failImage = false, failBlob = false } = {}) {
  const urls: string[] = []
  class Image {
    onload?: () => void
    onerror?: () => void
    set src(value: string) {
      urls.push(value)
      queueMicrotask(() => (failImage ? this.onerror?.() : this.onload?.()))
    }
  }
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({}),
    toBlob: vi.fn((callback: (value: Blob | null) => void) =>
      callback(failBlob ? null : new Blob([new Uint8Array([137, 80, 78, 71])]))),
  }
  vi.stubGlobal("Image", Image)
  vi.stubGlobal("document", {
    fonts: { load: vi.fn().mockResolvedValue([]) },
    createElement: () => canvas,
  })
  return { canvas, urls }
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("slide PNG downloads", () => {
  it("compresses website artwork at 1280 × 720 without changing PNG downloads", async () => {
    const { canvas } = browser()
    const slide = { url: "/bg.png", label: "Welcome" }
    await renderSlideJpeg(slide)
    expect(canvas).toMatchObject({ width: 1280, height: 720 })
    expect(drawImageSlide).toHaveBeenLastCalledWith(
      expect.anything(), expect.anything(), slide, 1280, 720, undefined, undefined
    )
    expect(canvas.toBlob).toHaveBeenLastCalledWith(expect.any(Function), "image/jpeg", 0.74)
    await renderSlidePng(slide)
    expect(canvas).toMatchObject({ width: 1920, height: 1080 })
    expect(canvas.toBlob).toHaveBeenLastCalledWith(expect.any(Function), "image/png", undefined)
  })
  it("exports the complete title, portrait and logo at 1920 × 1080", async () => {
    const { canvas, urls } = browser()
    save.mockResolvedValue(true)
    const slide = {
      url: "/bg.png",
      label: "Title",
      textOverlay: {
        layout: "title" as const,
        title: "Faith",
        body: "Pastor John Kennedy",
      },
    }
    expect(await downloadSessionSlide(slide, "Faith / Hope", "4")).toBe(true)
    expect(canvas).toMatchObject({ width: 1920, height: 1080 })
    expect(urls).toEqual([
      "/bg.png",
      "asset:/managed/portrait.png",
      "asset:/managed/logo.png",
    ])
    expect(drawImageSlide).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      slide,
      1920,
      1080,
      expect.anything(),
      expect.anything()
    )
    expect(save).toHaveBeenCalledWith(
      new Uint8Array([137, 80, 78, 71]),
      "faith-hope-4.png",
      { name: "PNG image", extensions: ["png"] }
    )
  })
  it("handles a cancelled save without reporting success", async () => {
    browser()
    save.mockResolvedValue(false)
    expect(
      await downloadSessionSlide(
        { url: "/bg.png", label: "Welcome" },
        "Welcome",
        "1"
      )
    ).toBe(false)
  })
  it("does not save an incomplete image when its background fails", async () => {
    browser({ failImage: true })
    await expect(
      downloadSessionSlide(
        { url: "/missing.png", label: "Missing" },
        "Missing",
        "1"
      )
    ).rejects.toThrow("could not be loaded")
    expect(save).not.toHaveBeenCalled()
  })
  it("reports PNG encoding failure", async () => {
    browser({ failBlob: true })
    await expect(
      renderSlidePng({ url: "/bg.png", label: "Welcome" })
    ).rejects.toThrow("Could not export")
  })
})
