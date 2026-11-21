import {
  SearchIcon,
  FolderIcon,
  ImageIcon,
  UploadIcon,
  XIcon,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { PanelHeader } from "@/components/ui/panel-header"
import { cn } from "@/lib/utils"
import { useMediaLibrary } from "./media/(hooks)/use-media-library"
import { MediaTile } from "./media/(components)/media-tile"
import type { Tab, OnlineFilter } from "./media/(lib)/media"

export function MediaPanel() {
  const {
    placeholder,
    tab,
    setTab,
    query,
    setQuery,
    hits,
    loading,
    error,
    onlineFilter,
    setOnlineFilter,
    savedIds,
    pexelsKey,
    unsplashKey,
    braveKey,
    localFolder,
    search,
    pickFolder,
    clearFolder,
    pickSingleFile,
    onGoLive,
    onEnqueue,
    onAddToPlan,
    onDownload,
    onDelete,
    run,
  } = useMediaLibrary()
  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Media" />

      <div className="flex items-center gap-2 border-b border-border/60 px-2 py-2">
        <div className="relative flex-1">
          <SearchIcon className="absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void search()
            }}
            placeholder={placeholder}
            className="h-7 pl-7 text-xs"
          />
        </div>
        {tab === "local" && (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={pickSingleFile}
              disabled={loading}
              className="shrink-0 gap-1 text-xs"
              title="Import an image or video"
            >
              <UploadIcon className="size-3" />
              File
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={pickFolder}
              className="shrink-0 gap-1 text-xs"
              title={localFolder ? "Change folder" : "Pick folder"}
            >
              <FolderIcon className="size-3" />
              Folder
            </Button>
          </>
        )}
      </div>

      <div className="flex gap-1 border-b border-border/40 px-2 py-1 text-[11px]">
        {(["local", "online"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "rounded px-2 py-1 capitalize transition-colors",
              tab === t
                ? "bg-muted font-semibold text-foreground"
                : "text-muted-foreground hover:bg-muted/50"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "local" && localFolder && (
        <div className="flex items-center gap-1.5 border-b border-border/40 bg-muted/20 px-2 py-1 text-[10px] text-muted-foreground">
          <FolderIcon className="size-2.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate" title={localFolder}>
            {localFolder}
          </span>
          <button
            onClick={clearFolder}
            className="shrink-0 rounded p-0.5 hover:bg-destructive/20 hover:text-destructive"
            title="Clear folder"
          >
            <XIcon className="size-2.5" />
          </button>
        </div>
      )}

      {tab === "local" && !localFolder && hits.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 p-8 text-center text-xs text-muted-foreground">
          <FolderIcon className="size-8 text-muted-foreground/40" />
          <p>Pick a folder or a image or video to start.</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={pickSingleFile}>
              Choose file
            </Button>
            <Button size="sm" variant="outline" onClick={pickFolder}>
              Choose folder
            </Button>
          </div>
        </div>
      )}

      {tab === "online" && !pexelsKey && !unsplashKey && !braveKey && (
        <div className="flex flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
          <ImageIcon className="size-7 text-muted-foreground/40" />
          <p>
            Add a Pexels, Unsplash, or Brave API key in Settings → API Keys to
            search online.
          </p>
        </div>
      )}

      {tab === "online" &&
        (pexelsKey || unsplashKey || braveKey) &&
        hits.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 border-b border-border/40 px-2 py-1.5">
            {(() => {
              const counts: Record<OnlineFilter, number> = {
                all: hits.length,
                pexels: hits.filter((h) => h.provider === "pexels").length,
                unsplash: hits.filter((h) => h.provider === "unsplash").length,
                brave: hits.filter((h) => h.provider === "brave").length,
              }
              const chips: {
                id: OnlineFilter
                label: string
                show: boolean
              }[] = [
                { id: "all", label: "All", show: true },
                {
                  id: "pexels",
                  label: "Pexels",
                  show: !!pexelsKey && counts.pexels > 0,
                },
                {
                  id: "unsplash",
                  label: "Unsplash",
                  show: !!unsplashKey && counts.unsplash > 0,
                },
                {
                  id: "brave",
                  label: "Brave",
                  show: !!braveKey && counts.brave > 0,
                },
              ]
              return chips
                .filter((c) => c.show)
                .map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setOnlineFilter(c.id)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
                      onlineFilter === c.id
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/60"
                    )}
                  >
                    {c.label}
                    <span
                      className={cn(
                        "rounded-full px-1 text-[9px] tabular-nums",
                        onlineFilter === c.id
                          ? "bg-primary-foreground/20"
                          : "bg-foreground/10"
                      )}
                    >
                      {counts[c.id]}
                    </span>
                  </button>
                ))
            })()}
          </div>
        )}

      {error && (
        <div className="border-b border-destructive/20 bg-destructive/5 px-3 py-2 text-[10px] text-destructive">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {(() => {
          const visibleHits =
            tab === "online" && onlineFilter !== "all"
              ? hits.filter((h) => h.provider === onlineFilter)
              : hits
          if (loading && visibleHits.length === 0) {
            return (
              <p className="p-4 text-center text-xs text-muted-foreground">
                Searching…
              </p>
            )
          }
          if (visibleHits.length === 0) {
            if (tab === "online" && query.trim() && !error) {
              return (
                <p className="p-4 text-center text-xs text-muted-foreground">
                  No matches.
                </p>
              )
            }
            return null
          }
          return (
            <ul className="grid grid-cols-2 gap-1.5">
              {visibleHits.map((hit) => (
                <MediaTile
                  key={hit.id}
                  hit={hit}
                  saved={savedIds.has(hit.id)}
                  onGoLive={() => run(() => onGoLive(hit))}
                  onEnqueue={() => run(() => onEnqueue(hit))}
                  onAddToPlan={() => run(() => onAddToPlan(hit))}
                  onDownload={
                    hit.provider === "pexels" ||
                    hit.provider === "unsplash" ||
                    hit.provider === "brave"
                      ? () => run(() => onDownload(hit))
                      : undefined
                  }
                  onDelete={
                    (hit.provider === "local" || hit.provider === "library") &&
                    hit.localPath
                      ? () => run(() => onDelete(hit))
                      : undefined
                  }
                />
              ))}
            </ul>
          )
        })()}
      </div>
    </div>
  )
}
