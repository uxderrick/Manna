import { prepareSongSearch, searchSongs } from "./song-search"
import type { Song } from "@/types"

let songs: Song[] = []

self.onmessage = (
  event: MessageEvent<{
    songs?: Song[]
    query?: string
    requestId?: number
  }>
) => {
  if (event.data.songs) {
    songs = event.data.songs
    prepareSongSearch(songs)
    return
  }
  self.postMessage({
    requestId: event.data.requestId,
    ids: searchSongs(songs, event.data.query ?? "").map((song) => song.id),
  })
}
