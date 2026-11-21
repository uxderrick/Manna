// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { SongResults } from "./song-results"
import type { Song } from "@/types"

let container: HTMLDivElement
let root: Root
const songs = Array.from({ length: 3845 }, (_, index) => ({
  id: String(index),
  title: `Song ${index}`,
  source: "custom",
  number: null,
  author: null,
})) as Song[]
const onOpen = vi.fn(),
  onAdd = vi.fn(),
  onJump = vi.fn()

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  )
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 0)
  )
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  vi.clearAllMocks()
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
async function mount() {
  await act(async () =>
    root.render(
      <SongResults
        songs={songs}
        onOpen={onOpen}
        onAdd={onAdd}
        onJump={onJump}
      />
    )
  )
}

it("renders a bounded window and makes the final song reachable by scrolling", async () => {
  await mount()
  expect(container.querySelectorAll("li").length).toBeLessThan(30)
  expect(container.textContent).toContain("Song 0")
  const viewport = container.firstElementChild as HTMLElement
  await act(async () => {
    viewport.scrollTop = 3840 * 64
    viewport.dispatchEvent(new Event("scroll", { bubbles: true }))
  })
  expect(container.textContent).toContain("Song 3844")
  expect(container.querySelectorAll("li").length).toBeLessThan(30)
})

it("preserves open, Go Live, and queue actions", async () => {
  await mount()
  const buttons = container.querySelector("li")!.querySelectorAll("button")
  await act(async () => buttons.forEach((button) => button.click()))
  expect(onOpen).toHaveBeenCalledWith("0")
  expect(onJump).toHaveBeenCalledWith("0")
  expect(onAdd).toHaveBeenCalledWith("0")
})

it("keeps keyboard navigation working across the rendered window boundary", async () => {
  await mount()
  const last = container.querySelector("li:last-child") as HTMLElement
  const index = Number(last.dataset.songIndex)
  const lastButton = last.querySelectorAll("button")[2]
  await act(async () => {
    lastButton.focus()
    lastButton.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      })
    )
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
  // The focus callback runs after React commits the newly visible rows.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
  expect(
    document.activeElement?.closest<HTMLElement>("[data-song-index]")?.dataset
      .songIndex
  ).toBe(String(index + 1))
})
