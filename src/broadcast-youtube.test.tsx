// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { BUILTIN_THEMES } from "@/lib/builtin-themes"
const { handlers, emit } = vi.hoisted(() => ({
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
  emit: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@tauri-apps/api/event", () => ({
  emit,
  listen: vi.fn(
    async (name: string, callback: (event: { payload: unknown }) => void) => {
      handlers.set(name, callback)
      return () => handlers.delete(name)
    }
  ),
}))
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(null),
}))
vi.mock("@tauri-apps/plugin-log", () => ({
  info: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    label: "broadcast",
    emitTo: vi.fn().mockResolvedValue(undefined),
    listen: async (
      name: string,
      callback: (event: { payload: unknown }) => void
    ) => {
      handlers.set(name, callback)
      return () => handlers.delete(name)
    },
  }),
}))
vi.mock("@/lib/church-assets", () => ({
  initializeChurchAssets: vi.fn(),
  resolveChurchAsset: (url: string) => url,
  hasChurchAsset: () => false,
}))
vi.mock("@/components/broadcast/youtube-player", () => ({
  YouTubePlayer: ({ muted, volume }: { muted: boolean; volume: number }) => (
    <iframe
      title="YouTube live video"
      data-muted={String(muted)}
      data-volume={String(volume)}
    />
  ),
}))
vi.mock("@/lib/verse-renderer", () => ({ renderVerse: () => ({}) }))
vi.mock("@/lib/after-broadcast-paint", () => ({
  afterBroadcastPaint: () => () => {},
}))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  handlers.clear()
})
it("removes the streaming player on hide, replacement, announcements and NDI", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { load: () => Promise.resolve([]) },
  })
  const context = {
    fillRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    drawImage: vi.fn(),
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    measureText: () => ({ width: 10 }),
    fillText: vi.fn(),
  }
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as CanvasRenderingContext2D
  )
  const { BroadcastCanvas } = await import("./broadcast-output")
  const container = document.createElement("div")
  const root = createRoot(container)
  const payload = {
    theme: BUILTIN_THEMES[0],
    verse: null,
    hidden: false,
    fullscreenImage: {
      mediaType: "youtube",
      url: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
      label: "Worship",
      playbackId: "one",
    },
  }
  const update = async (value: unknown) => {
    await act(async () => {
      handlers.get("broadcast:verse-update:main")!({ payload: value })
    })
  }
  try {
    await act(async () => root.render(<BroadcastCanvas />))
    await update(payload)
    expect(container.querySelector("iframe")?.dataset.muted).toBe("false")
    const originalFrame = container.querySelector("iframe")
    await update({
      ...payload,
      fullscreenImage: { ...payload.fullscreenImage, volume: 35 },
    })
    expect(container.querySelector("iframe")).toBe(originalFrame)
    expect(container.querySelector("iframe")?.dataset.volume).toBe("35")
    await update({ ...payload, hidden: true })
    expect(container.querySelector("iframe")).toBeNull()
    await update(payload)
    await act(async () => {
      handlers.get("broadcast:announcement:main")!({
        payload: { mode: "ticker", text: "Notice" },
      })
    })
    expect(container.querySelector("iframe")).toBeNull()
    await act(async () => {
      handlers.get("broadcast:announcement:main")!({ payload: null })
    })
    expect(container.querySelector("iframe")).not.toBeNull()
    await update({ ...payload, fullscreenImage: null })
    expect(container.querySelector("iframe")).toBeNull()
    await update(payload)
    await act(async () => {
      handlers.get("broadcast:ndi-config:main")!({
        payload: { active: true, width: 1920, height: 1080, fps: 24 },
      })
    })
    expect(container.querySelector("iframe")).toBeNull()
    expect(emit).toHaveBeenCalledWith(
      "broadcast:youtube-status",
      expect.objectContaining({ state: "error" })
    )
  } finally {
    await act(async () => root.unmount())
  }
})
