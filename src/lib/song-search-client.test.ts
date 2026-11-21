import { afterEach, expect, it, vi } from "vitest"
import type { Song } from "@/types"

class SearchWorker {
  static instance: SearchWorker
  onmessage:
    | ((event: { data: { requestId: number; ids: string[] } }) => void)
    | null = null
  onerror: (() => void) | null = null
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor() {
    SearchWorker.instance = this
  }
}

const song = {
  id: "grace",
  title: "Amazing Grace",
  number: 42,
  source: "ghs",
  author: "Newton",
  stanzas: [],
} as unknown as Song

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

it("warms the worker once and reuses its index after a panel remount", async () => {
  vi.stubGlobal("Worker", SearchWorker)
  const { searchSongsInBackground } = await import("./song-search-client")
  await searchSongsInBackground([song], "")
  const worker = SearchWorker.instance
  const result = searchSongsInBackground([song], "grace")
  expect(
    worker.postMessage.mock.calls.filter(([message]) => message.songs)
  ).toHaveLength(1)
  const request = worker.postMessage.mock.calls.at(-1)![0]
  worker.onmessage!({ data: { requestId: request.requestId, ids: ["grace"] } })
  expect(await result).toEqual([song])
})

it("maps overlapping responses to the correct library, preserving result order", async () => {
  vi.stubGlobal("Worker", SearchWorker)
  const { searchSongsInBackground } = await import("./song-search-client")
  const first = searchSongsInBackground([song], "grace")
  const worker = SearchWorker.instance
  const requestA = worker.postMessage.mock.calls.at(-1)![0]
  const edited = { ...song, title: "Edited Grace" }
  const second = searchSongsInBackground([edited], "grace")
  const requestB = worker.postMessage.mock.calls.at(-1)![0]
  worker.onmessage!({ data: { requestId: requestB.requestId, ids: ["grace"] } })
  worker.onmessage!({ data: { requestId: requestA.requestId, ids: ["grace"] } })
  expect((await first)[0]).toBe(song)
  expect((await second)[0]).toBe(edited)
  expect(
    worker.postMessage.mock.calls.filter(([message]) => message.songs)
  ).toHaveLength(2)
})

it("continues to search if workers are unavailable or fail", async () => {
  vi.stubGlobal("Worker", SearchWorker)
  const { searchSongsInBackground } = await import("./song-search-client")
  const result = searchSongsInBackground([song], "42")
  SearchWorker.instance.onerror!()
  expect(await result).toEqual([song])
  expect(await searchSongsInBackground([song], "grace")).toEqual([song])
})
