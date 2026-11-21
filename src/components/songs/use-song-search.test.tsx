// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { useSongSearch } from "./use-song-search"
import type { Song } from "@/types"

const search = vi.hoisted(() => vi.fn())
vi.mock("@/lib/song-search-client", () => ({ searchSongsInBackground: search }))

it("ignores stale responses and skips local work while online search is selected", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const library = [{ id: "a", title: "Amazing Grace" }] as Song[]
  const callbacks = new Map<string, (songs: Song[]) => void>()
  search.mockImplementation(
    (_songs, query) => new Promise((resolve) => callbacks.set(query, resolve))
  )
  const container = document.createElement("div")
  const root = createRoot(container)
  function Search({
    query,
    enabled = true,
  }: {
    query: string
    enabled?: boolean
  }) {
    const result = useSongSearch(library, query, enabled)
    return (
      <div>
        {query}|{result.songs.map((song) => song.title).join()}|
        {String(result.pending)}
      </div>
    )
  }
  try {
    await act(async () => root.render(<Search query="a" />))
    await act(async () => root.render(<Search query="grace" />))
    expect(container.textContent).toBe("grace||true")
    await act(async () => callbacks.get("grace")!(library))
    await act(async () => callbacks.get("a")!([]))
    expect(container.textContent).toBe("grace|Amazing Grace|false")
    await act(async () =>
      root.render(<Search query="online" enabled={false} />)
    )
    expect(search).toHaveBeenCalledTimes(2)
  } finally {
    await act(async () => root.unmount())
  }
})
