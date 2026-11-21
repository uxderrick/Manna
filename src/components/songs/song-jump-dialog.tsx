import { useEffect, useRef, useState } from "react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useSongSearch } from "./use-song-search"
import { useQueueStore, useSongStore } from "@/stores"

export function SongJumpDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  if (!open) return null
  return <SongJumpContent onOpenChange={onOpenChange} />
}

function SongJumpContent({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const songs = useSongStore((s) => s.songs)
  const jumpLive = useQueueStore((s) => s.jumpLiveSong)
  const [query, setQuery] = useState("")
  const pendingSelection = useRef<string | null>(null)

  const results = useSongSearch(songs, query)
  const hits = results.songs.slice(0, 8)

  // Honour Enter pressed while the worker is still finishing this query.
  useEffect(() => {
    if (results.pending || pendingSelection.current !== query) return
    pendingSelection.current = null
    if (results.songs[0]) {
      jumpLive(results.songs[0].id)
      onOpenChange(false)
    }
  }, [results.pending, results.songs, query, jumpLive, onOpenChange])

  const pick = (id: string) => {
    jumpLive(id)
    onOpenChange(false)
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 gap-0">
        <Input
          autoFocus
          value={query}
          onChange={(e) => {
            pendingSelection.current = null
            setQuery(e.target.value)
          }}
          placeholder="Type hymn number or title…"
          className="border-0 rounded-none focus-visible:ring-0"
          onKeyDown={(e) => {
            if (e.key !== "Enter") return
            if (results.pending) pendingSelection.current = query
            else if (hits[0]) pick(hits[0].id)
          }}
        />
        <ul aria-busy={results.pending} className="max-h-80 divide-y divide-border/40 overflow-auto">
          {hits.map((song) => (
            <li key={song.id}>
              <button
                onClick={() => pick(song.id)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
              >
                {song.number !== null && (
                  <span className="w-8 shrink-0 tabular-nums text-muted-foreground">{song.number}</span>
                )}
                <span className="truncate">{song.title}</span>
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
