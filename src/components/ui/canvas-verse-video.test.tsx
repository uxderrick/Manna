// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { CanvasVerse } from "./canvas-verse"
import { BUILTIN_THEMES } from "@/lib/builtin-themes"
import { withLiveBackground } from "@/lib/live-backgrounds"

const { start, stop } = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn() }))
vi.mock("@/lib/looping-video", () => ({
  startLoopingVideo: start,
  drawVideoCover: () => true,
}))
vi.mock("@/lib/verse-renderer", () => ({ renderVerse: () => ({}) }))
vi.mock("@/lib/church-assets", () => ({
  resolveChurchAsset: (url: string) => url,
  hasChurchAsset: () => false,
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  start.mockReset()
  stop.mockReset()
})

it("retains the decoder across verse and darkness changes, then stops it for still backgrounds", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal(
    "ResizeObserver",
    class {
      private callback: ResizeObserverCallback
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
      }
      observe() {
        this.callback(
          [{ contentRect: { width: 400 } }] as ResizeObserverEntry[],
          this as unknown as ResizeObserver
        )
      }
      disconnect() {}
    }
  )
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { load: () => Promise.resolve([]) },
  })
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  start.mockImplementation(() => ({ video: {}, stop }))
  const container = document.createElement("div")
  const root = createRoot(container)
  const verse = {
    reference: "John 3:16",
    segments: [{ text: "For God so loved the world" }],
  }
  const theme = withLiveBackground(BUILTIN_THEMES[0], {
    id: "aurora-cool",
    dimming: 0.25,
  })
  try {
    await act(async () =>
      root.render(<CanvasVerse theme={theme} verse={verse} />)
    )
    expect(start).toHaveBeenCalledTimes(1)
    await act(async () =>
      root.render(
        <CanvasVerse
          theme={{
            ...theme,
            background: {
              ...theme.background,
              video: { ...theme.background.video!, dimming: 0.4 },
            },
          }}
          verse={{ ...verse, reference: "John 3:17" }}
        />
      )
    )
    expect(start).toHaveBeenCalledTimes(1)
    expect(stop).not.toHaveBeenCalled()
    await act(async () =>
      root.render(<CanvasVerse theme={BUILTIN_THEMES[0]} verse={verse} />)
    )
    expect(stop).toHaveBeenCalledTimes(1)
    await act(async () =>
      root.render(<CanvasVerse theme={theme} verse={verse} />)
    )
    expect(start).toHaveBeenCalledTimes(2)
    await act(async () => root.render(
      <CanvasVerse theme={theme} verse={verse} fullscreenImage={{ url: "/candle.mp4", label: "Candle", mediaType: "video" }} />
    ))
    expect(start).toHaveBeenLastCalledWith("/candle.mp4", expect.any(Function), expect.any(Function))
    expect(stop).toHaveBeenCalledTimes(2)
    await act(async () => root.render(
      <CanvasVerse theme={theme} verse={verse} fullscreenImage={{ url: "/still.png", label: "Still" }} />
    ))
    expect(stop).toHaveBeenCalledTimes(3)
  } finally {
    await act(async () => root.unmount())
  }
  expect(stop).toHaveBeenCalledTimes(3)
})
