import { useEffect, useState } from "react"
import { searchSongsInBackground } from "@/lib/song-search-client"
import type { Song } from "@/types"

export function useSongSearch(library: Song[], query: string, enabled = true) {
  const [result, setResult] = useState<{
    library: Song[]
    query: string
    songs: Song[]
  } | null>(null)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void searchSongsInBackground(library, query).then((songs) => {
      if (!cancelled) setResult({ library, query, songs })
    })
    return () => {
      cancelled = true
    }
  }, [library, query, enabled])

  const empty = !query.trim()
  return {
    songs: empty ? library : result?.library === library ? result.songs : [],
    resultQuery: empty ? "" : (result?.query ?? ""),
    pending: !empty && (result?.query !== query || result.library !== library),
  }
}
