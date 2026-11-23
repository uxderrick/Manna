// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { YouTubePlayer } from "./youtube-player"
const { emit, invoke, unlisten, listeners } = vi.hoisted(() => ({
  emit: vi.fn().mockResolvedValue(undefined),
  invoke: vi
    .fn()
    .mockImplementation(async (command: string) =>
      command === "youtube_output_visible"
        ? true
        : "http://127.0.0.1:43111/youtube-player.html"
    ),
  unlisten: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}))
vi.mock("@tauri-apps/api/core", () => ({ invoke }))
vi.mock("@tauri-apps/api/event", () => ({
  emit,
  listen: vi.fn(
    (name: string, callback: (event: { payload: unknown }) => void) => {
      listeners.set(name, callback)
      return Promise.resolve(unlisten)
    }
  ),
}))
afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  listeners.clear()
})
it("uses the official wrapper, validates status, forwards controls and removes audio on unmount", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  const url = "https://www.youtube.com/watch?v=M7lc1UVf-VE"
  try {
    await act(async () =>
      root.render(<YouTubePlayer url={url} muted={false} volume={35} />)
    )
    const frame = container.querySelector("iframe")!
    expect(frame.src).toContain("video=M7lc1UVf-VE")
    expect(frame.src).toContain("muted=0")
    expect(frame.src).toContain("volume=35")
    expect(frame.getAttribute("allow")).toContain("autoplay")
    const data = {
      type: "manna-youtube-status",
      videoId: "M7lc1UVf-VE",
      state: "playing",
    }
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          origin: "https://evil.test",
          data,
        })
      )
    })
    expect(emit).not.toHaveBeenCalled()
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          origin: "http://127.0.0.1:43111",
          data,
        })
      )
    })
    expect(emit).toHaveBeenCalledWith(
      "broadcast:youtube-status",
      expect.objectContaining({ url, state: "playing" })
    )
    const post = vi.spyOn(frame.contentWindow!, "postMessage")
    listeners.get("broadcast:youtube-control")!({
      payload: { url, command: { action: "pause" } },
    })
    expect(post).toHaveBeenCalledWith(
      { type: "manna-youtube-command", command: { action: "pause" } },
      "http://127.0.0.1:43111"
    )
    await act(async () =>
      root.render(<YouTubePlayer key="alt" url={url} muted={true} />)
    )
    expect(container.querySelector("iframe")?.src).toContain("muted=1")
    expect(unlisten).toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
  expect(container.querySelector("iframe")).toBeNull()
})
it("reports player failure and removes the iframe instead of leaving audio running", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () =>
      root.render(
        <YouTubePlayer url="https://youtu.be/M7lc1UVf-VE" muted={false} />
      )
    )
    const frame = container.querySelector("iframe")!
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          origin: "http://127.0.0.1:43111",
          data: {
            type: "manna-youtube-status",
            videoId: "M7lc1UVf-VE",
            state: "error",
            message: "Private video",
          },
        })
      )
    })
    expect(container.querySelector("iframe")).toBeNull()
    expect(container.textContent).toContain("Video unavailable")
    expect(emit).toHaveBeenCalledWith(
      "broadcast:youtube-status",
      expect.objectContaining({ state: "error", message: "Private video" })
    )
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})

it("does not start audio while the native window is hidden and removes the frame when it is hidden again", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.useFakeTimers()
  let shown = false
  invoke.mockImplementation(async (command: string) =>
    command === "youtube_output_visible"
      ? shown
      : "http://127.0.0.1:43111/youtube-player.html"
  )
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () =>
      root.render(
        <YouTubePlayer url="https://youtu.be/M7lc1UVf-VE" muted={false} />
      )
    )
    expect(container.querySelector("iframe")).toBeNull()
    shown = true
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(container.querySelector("iframe")).not.toBeNull()
    shown = false
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(container.querySelector("iframe")).toBeNull()
    expect(unlisten).toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    container.remove()
    vi.useRealTimers()
    invoke.mockImplementation(async (command: string) =>
      command === "youtube_output_visible"
        ? true
        : "http://127.0.0.1:43111/youtube-player.html"
    )
  }
})
