import { useMemo, useState } from "react"
import { DownloadIcon, MusicIcon, PlayIcon, PlusIcon, SearchIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PanelHeader } from "@/components/ui/panel-header"
import { cn } from "@/lib/utils"
import { searchSongs } from "@/lib/song-search"
import { useQueueStore, useSongStore, useSettingsStore } from "@/stores"
import { isHymnalSource } from "@/types"
import type { Song } from "@/types"
import { PasteLyricsDialog } from "@/components/songs/paste-lyrics-dialog"
import { openSettings } from "@/lib/settings-dialog"
import { OnlineSearchResults } from "@/components/songs/online-search-results"
import { SongDetailDrawer } from "@/components/songs/song-detail-drawer"
import { SourceBadge } from "@/components/songs/source-badge"

type Tab = "local" | "online" | "ewc"

export function SongsPanel() {
  const allSongs = useSongStore((s) => s.songs)
  const enabledHymnals = useSettingsStore((s) => s.enabledHymnals)
  const enqueueSong = useQueueStore((s) => s.enqueueSong)
  const presentSongLive = useQueueStore((s) => s.presentSongLive)
  const [query, setQuery] = useState("")
  const [tab, setTab] = useState<Tab>("local")
  const [pasteOpen, setPasteOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)

  const songs = useMemo(
    () =>
      allSongs.filter(
        // Bundled hymnals can be switched off in settings; everything the
        // church added (pasted, online, imported) always shows.
        (s) => !isHymnalSource(s.source) || enabledHymnals.includes(s.source),
      ),
    [allSongs, enabledHymnals],
  )

  // "EWC Live" is an artist — the EWC tab shows only songs by that author.
  const ewcSongs = useMemo(
    () => songs.filter((s) => (s.author ?? "").toLowerCase().includes("ewc live")),
    [songs],
  )

  // Local tab searches all local songs; EWC tab searches within EWC-Live songs.
  const filtered = useMemo(
    () => searchSongs(tab === "ewc" ? ewcSongs : songs, query),
    [songs, ewcSongs, query, tab],
  )

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
        <Button
          size="sm"
          variant="outline"
          onClick={() => openSettings("import")}
          className="shrink-0 gap-1 text-xs"
          title="Import songs, slides, services and Bibles from OpenLP, EasyWorship, ProPresenter or SongSelect"
        >
          <DownloadIcon className="size-3" />
          Import
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
            tab === "online" ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:bg-muted/50",
          )}
          onClick={() => setTab("online")}
        >
          Search Online
        </button>
        <button
          className={cn(
            "rounded px-2 py-1 transition-colors",
            tab === "ewc" ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:bg-muted/50",
          )}
          onClick={() => setTab("ewc")}
        >
          EWC Live ({ewcSongs.length})
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "online" ? (
          <OnlineSearchResults
            query={query}
            onImported={(songId) => {
              setTab("local")
              setDetailId(songId)
            }}
          />
        ) : filtered.length === 0 ? (
          tab === "ewc" ? (
            <div className="px-4 py-12 text-center text-xs text-muted-foreground">
              No EWC Live songs yet. Songs by the artist “EWC Live” appear here.
            </div>
          ) : (
            <EmptyLocal onPaste={() => setPasteOpen(true)} onOnline={() => setTab("online")} />
          )
        ) : (
          <ul className="divide-y divide-border/40">
            {filtered.map((song) => (
              <SongRow
                key={song.id}
                song={song}
                onOpen={() => setDetailId(song.id)}
                onAdd={() => enqueueSong(song.id)}
                onJump={() => presentSongLive(song.id)}
              />
            ))}
          </ul>
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
    <li className="group flex items-center gap-3 p-3 transition-colors hover:bg-muted/40">
      <SourceBadge source={song.source} />
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className="flex items-baseline gap-2">
          {song.number !== null && (
            <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
              {song.number}
            </span>
          )}
          <span className="truncate text-sm font-medium">{song.title}</span>
        </div>
        {song.author && (
          <div className="truncate text-xs text-muted-foreground">{song.author}</div>
        )}
      </button>
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <Button
          size="xs"
          variant="default"
          onClick={(e) => { e.stopPropagation(); onJump() }}
          className="h-6 gap-1 px-2 text-[10px]"
          title="Broadcast immediately"
        >
          <PlayIcon className="size-2.5" />
          Go Live
        </Button>
        <Button
          size="xs"
          variant="outline"
          onClick={(e) => { e.stopPropagation(); onAdd() }}
          className="h-6 gap-1 px-2 text-[10px]"
          title="Add to queue"
        >
          <PlusIcon className="size-2.5" />
          RTQ
        </Button>
      </div>
    </li>
  )
}

function EmptyLocal({ onPaste, onOnline }: { onPaste: () => void; onOnline: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-8 text-center text-xs text-muted-foreground">
      <MusicIcon className="size-8 text-muted-foreground/40" />
      <p>No matches. Try &quot;mhb 42&quot;, &quot;snk 150&quot;, or a hymn title.</p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={onOnline}>
          Search Online
        </Button>
        <Button size="sm" variant="outline" onClick={onPaste}>
          Paste new hymn
        </Button>
      </div>
    </div>
  )
}
