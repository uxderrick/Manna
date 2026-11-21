// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { useQueueStore } from "@/stores/queue-store"
import { SongJumpDialog } from "./song-jump-dialog"
import type { Song } from "@/types"

let searchState = {
  songs: [{ id: "stale", title: "Previous result", number: null }] as Song[],
  pending: true,
  resultQuery: "",
}
vi.mock("./use-song-search", () => ({ useSongSearch: () => searchState }))

it("honours Enter after the current search finishes without broadcasting a stale result", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  const originalJump = useQueueStore.getState().jumpLiveSong
  const jump = vi.fn()
  const onOpenChange = vi.fn()
  useQueueStore.setState({ jumpLiveSong: jump })
  try {
    await act(async () => root.render(<SongJumpDialog open onOpenChange={onOpenChange} />))
    const input = document.querySelector<HTMLInputElement>('input[placeholder="Type hymn number or title…"]')!
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })))
    expect(jump).not.toHaveBeenCalled()
    searchState = { ...searchState, pending: false, songs: [{ id: "current", title: "Current result", number: null }] as Song[] }
    await act(async () => root.render(<SongJumpDialog open onOpenChange={onOpenChange} />))
    expect(jump).toHaveBeenCalledExactlyOnceWith("current")
    expect(onOpenChange).toHaveBeenCalledWith(false)
  } finally {
    await act(async () => root.unmount())
    useQueueStore.setState({ jumpLiveSong: originalJump })
    container.remove()
  }
})
