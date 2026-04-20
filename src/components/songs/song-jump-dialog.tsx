import { useEffect, useMemo, useState } from "react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { searchSongs } from "@/lib/song-search"
import { useQueueStore, useSongStore } from "@/stores"

export function SongJumpDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const songs = useSongStore((s) => s.songs)
  const jumpLive = useQueueStore((s) => s.jumpLiveSong)
  const [query, setQuery] = useState("")

  useEffect(() => {
    if (!open) setQuery("")
  }, [open])

  const hits = useMemo(() => searchSongs(songs, query).slice(0, 8), [songs, query])

  const pick = (id: string) => {
    jumpLive(id)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 gap-0">
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type hymn number or title…"
          className="border-0 rounded-none focus-visible:ring-0"
          onKeyDown={(e) => {
            if (e.key === "Enter" && hits[0]) pick(hits[0].id)
          }}
        />
        <ul className="max-h-80 divide-y divide-border/40 overflow-auto">
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
