import { useMemo, useState } from "react"
import { MusicIcon, PlusIcon, SearchIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PanelHeader } from "@/components/ui/panel-header"
import { cn } from "@/lib/utils"
import { useSongSearch } from "@/components/songs/use-song-search"
import { SongResults } from "@/components/songs/song-results"
import { useQueueStore, useSongStore, useSettingsStore } from "@/stores"
import { PasteLyricsDialog } from "@/components/songs/paste-lyrics-dialog"
import { OnlineSearchResults } from "@/components/songs/online-search-results"
import { SongDetailDrawer } from "@/components/songs/song-detail-drawer"

type Tab = "local" | "online" | "ewc"

export function SongsPanel() {
  const allSongs = useSongStore((s) => s.songs)
  const legacyEwc = useSettingsStore((s) => s.brand.legacyEwc)
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
        (s) =>
          s.source === "custom" ||
          s.source === "genius" ||
          s.source === "lrclib" ||
          s.source === "easyworship" ||
          enabledHymnals.includes(s.source),
      ),
    [allSongs, enabledHymnals],
  )

  // "EWC Live" is an artist — the EWC tab shows only songs by that author.
  const ewcSongs = useMemo(
    () => songs.filter((s) => (s.author ?? "").toLowerCase().includes("ewc live")),
    [songs],
  )

  // Local tab searches all local songs; EWC tab searches within EWC-Live songs.
  const { songs: filtered, pending, resultQuery } = useSongSearch(
    tab === "ewc" ? ewcSongs : songs, query, tab !== "online",
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
        {legacyEwc && <button
          className={cn(
            "rounded px-2 py-1 transition-colors",
            tab === "ewc" ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:bg-muted/50",
          )}
          onClick={() => setTab("ewc")}
        >
          EWC Live ({ewcSongs.length})
        </button>}
      </div>

      <div className={cn("min-h-0 flex-1", tab === "online" ? "overflow-auto" : "flex flex-col")} aria-busy={tab !== "online" && pending}>
        {tab === "online" ? (
          <OnlineSearchResults
            query={query}
            onImported={(songId) => {
              setTab("local")
              setDetailId(songId)
            }}
          />
        ) : filtered.length === 0 && pending ? (
          <div role="status" className="p-4 text-xs text-muted-foreground">Searching…</div>
        ) : filtered.length === 0 ? (
          tab === "ewc" ? (
            <div className="px-4 py-12 text-center text-xs text-muted-foreground">
              No EWC Live songs yet. Songs by the artist “EWC Live” appear here.
            </div>
          ) : (
            <EmptyLocal onPaste={() => setPasteOpen(true)} onOnline={() => setTab("online")} />
          )
        ) : (
          <SongResults
            key={`${tab}:${resultQuery}`}
            songs={filtered}
            onOpen={setDetailId}
            onAdd={enqueueSong}
            onJump={presentSongLive}
          />
        )}
      </div>

      <PasteLyricsDialog open={pasteOpen} onOpenChange={setPasteOpen} />
      <SongDetailDrawer songId={detailId} onClose={() => setDetailId(null)} />
    </div>
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
