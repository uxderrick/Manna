import { useMemo, useState } from "react"
import { MusicIcon, PlayIcon, PlusIcon, SearchIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PanelHeader } from "@/components/ui/panel-header"
import { cn } from "@/lib/utils"
import { searchSongs } from "@/lib/song-search"
import { useQueueStore, useSongStore } from "@/stores"
import type { Song } from "@/types"
import { PasteLyricsDialog } from "@/components/songs/paste-lyrics-dialog"
import { GeniusSearchResults } from "@/components/songs/genius-search-results"
import { SongDetailDrawer } from "@/components/songs/song-detail-drawer"

type Tab = "local" | "genius"

export function SongsPanel() {
  const songs = useSongStore((s) => s.songs)
  const enqueueSong = useQueueStore((s) => s.enqueueSong)
  const jumpLiveSong = useQueueStore((s) => s.jumpLiveSong)
  const [query, setQuery] = useState("")
  const [tab, setTab] = useState<Tab>("local")
  const [pasteOpen, setPasteOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)

  const filtered = useMemo(() => searchSongs(songs, query), [songs, query])

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Songs" />

      <div className="flex items-center gap-2 border-b border-border/60 px-2 py-2">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search hymns…"
            className="h-7 pl-7 text-xs"
          />
        </div>
        <Button size="sm" variant="outline" onClick={() => setPasteOpen(true)} className="shrink-0 gap-1 text-xs">
          <PlusIcon className="size-3" />
          New
        </Button>
      </div>

      <div className="flex gap-1 border-b border-border/40 px-2 py-1 text-[11px]">
        <button
          className={cn(
            "rounded px-2 py-1 transition-colors",
            tab === "local" ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:bg-muted/50",
          )}
          onClick={() => setTab("local")}
        >
          Local ({songs.length})
        </button>
        <button
          className={cn(
            "rounded px-2 py-1 transition-colors",
            tab === "genius" ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:bg-muted/50",
          )}
          onClick={() => setTab("genius")}
        >
          Search Genius
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "local" ? (
          filtered.length === 0 ? (
            <EmptyLocal onPaste={() => setPasteOpen(true)} onGenius={() => setTab("genius")} />
          ) : (
            <ul className="divide-y divide-border/40">
              {filtered.map((song) => (
                <SongRow
                  key={song.id}
                  song={song}
                  onOpen={() => setDetailId(song.id)}
                  onAdd={() => enqueueSong(song.id)}
                  onJump={() => jumpLiveSong(song.id)}
                />
              ))}
            </ul>
          )
        ) : (
          <GeniusSearchResults query={query} />
        )}
      </div>

      <PasteLyricsDialog open={pasteOpen} onOpenChange={setPasteOpen} />
      <SongDetailDrawer songId={detailId} onClose={() => setDetailId(null)} />
    </div>
  )
}

function SongRow({
  song,
  onOpen,
  onAdd,
  onJump,
}: {
  song: Song
  onOpen: () => void
  onAdd: () => void
  onJump: () => void
}) {
  return (
    <li className="group flex items-center gap-2 px-3 py-2 transition-colors hover:bg-muted/40">
      <MusicIcon className="size-3 shrink-0 text-muted-foreground" />
      <button onClick={onOpen} className="flex-1 truncate text-left text-xs">
        {song.number !== null && (
          <span className="mr-2 tabular-nums text-muted-foreground">{song.number}</span>
        )}
        {song.title}
      </button>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <Button size="icon-xs" variant="ghost" onClick={onAdd} title="Add to queue">
          <PlusIcon className="size-2.5" />
        </Button>
        <Button size="icon-xs" variant="ghost" onClick={onJump} title="Jump live">
          <PlayIcon className="size-2.5" />
        </Button>
      </div>
    </li>
  )
}

function EmptyLocal({ onPaste, onGenius }: { onPaste: () => void; onGenius: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-8 text-center text-xs text-muted-foreground">
      <MusicIcon className="size-8 text-muted-foreground/40" />
      <p>No matches.</p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={onGenius}>
          Search Genius
        </Button>
        <Button size="sm" variant="outline" onClick={onPaste}>
          Paste new hymn
        </Button>
      </div>
    </div>
  )
}
