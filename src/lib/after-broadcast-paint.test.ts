import { afterBroadcastPaint } from "./after-broadcast-paint"
import { afterEach, expect, it, vi } from "vitest"

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it("leaves a paint opportunity before running frame export", () => {
  vi.useFakeTimers()
  let frame: FrameRequestCallback = () => {}
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frame = callback
    return 1
  })
  vi.stubGlobal("cancelAnimationFrame", vi.fn())
  const exportFrame = vi.fn()
  afterBroadcastPaint(exportFrame)
  expect(exportFrame).not.toHaveBeenCalled()
  frame(0)
  expect(exportFrame).not.toHaveBeenCalled()
  vi.runAllTimers()
  expect(exportFrame).toHaveBeenCalledOnce()
})

it("cancels a superseded frame export after its animation callback", () => {
  vi.useFakeTimers()
  let frame: FrameRequestCallback = () => {}
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frame = callback
    return 1
  })
  vi.stubGlobal("cancelAnimationFrame", vi.fn())
  const exportFrame = vi.fn()
  const cancel = afterBroadcastPaint(exportFrame)
  frame(0)
  cancel()
  vi.runAllTimers()
  expect(exportFrame).not.toHaveBeenCalled()
})

it("exports hidden NDI output without waiting for suspended animation frames", () => {
  vi.useFakeTimers()
  vi.stubGlobal("document", { visibilityState: "hidden" })
  const requestFrame = vi.fn()
  vi.stubGlobal("requestAnimationFrame", requestFrame)
  const exportFrame = vi.fn()
  afterBroadcastPaint(exportFrame)
  vi.runAllTimers()
  expect(exportFrame).toHaveBeenCalledOnce()
  expect(requestFrame).not.toHaveBeenCalled()
})
