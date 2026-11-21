import { searchSongs } from "./song-search"
import type { Song } from "@/types"

let worker: Worker | null = null
let unavailable = false
let library: Song[] = []
let nextRequestId = 0
const pending = new Map<
  number,
  {
    songs: Song[]
    query: string
    resolve: (songs: Song[]) => void
    byId: Map<string, Song>
  }
>()

function stopWorker() {
  worker?.terminate()
  worker = null
  library = []
  unavailable = true
  // Keep search usable in environments that cannot create a module worker.
  for (const request of pending.values()) {
    request.resolve(searchSongs(request.songs, request.query))
  }
  pending.clear()
}

export function searchSongsInBackground(
  songs: Song[],
  query: string
): Promise<Song[]> {
  if (unavailable || typeof Worker === "undefined") {
    return Promise.resolve().then(() => searchSongs(songs, query))
  }
  try {
    if (!worker) {
      worker = new Worker(new URL("./song-search.worker.ts", import.meta.url), {
        type: "module",
      })
      worker.onmessage = (
        event: MessageEvent<{ requestId: number; ids: string[] }>
      ) => {
        const request = pending.get(event.data.requestId)
        if (!request) return
        pending.delete(event.data.requestId)
        request.resolve(
          event.data.ids
            .map((id) => request.byId.get(id))
            .filter((song): song is Song => Boolean(song))
        )
      }
      worker.onerror = stopWorker
    }
    // Filtering on a remounted panel creates a new array of the same songs.
    // Reuse the worker's index when the song objects and their order match.
    if (
      songs.length !== library.length ||
      songs.some((song, index) => song !== library[index])
    ) {
      worker.postMessage({ songs })
      library = songs
    }
    if (!query.trim()) return Promise.resolve(songs)
    const requestId = ++nextRequestId
    return new Promise((resolve) => {
      pending.set(requestId, {
        songs,
        query,
        resolve,
        byId: new Map(songs.map((song) => [song.id, song])),
      })
      try {
        worker!.postMessage({ requestId, query })
      } catch {
        stopWorker()
      }
    })
  } catch {
    stopWorker()
    return Promise.resolve().then(() => searchSongs(songs, query))
  }
}
