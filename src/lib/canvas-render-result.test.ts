import { describe, expect, it, vi } from "vitest"
import { renderAndReport } from "./canvas-render-result"

describe("renderAndReport", () => {
  it("renders even when no result listener is supplied", () => {
    const render = vi.fn(() => "drawn")

    expect(renderAndReport(render)).toBe("drawn")
    expect(render).toHaveBeenCalledOnce()
  })

  it("reports the render result when a listener is supplied", () => {
    const report = vi.fn()

    renderAndReport(() => "drawn", report)

    expect(report).toHaveBeenCalledWith("drawn")
  })
})
