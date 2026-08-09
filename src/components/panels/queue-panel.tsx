import { useState, useEffect, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import { PanelHeader } from "@/components/ui/panel-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  PlayIcon,
  XIcon,
  ListIcon,
  SearchIcon,
  PlusIcon,
  BookOpenIcon,
  MusicIcon,
  ImageIcon,
  ChevronDownIcon,
} from "lucide-react"
import { useQueueStore, useBroadcastStore, useBibleStore, useSongStore } from "@/stores"
import { queueVerseToRenderData } from "@/hooks/use-broadcast"
import { bibleActions } from "@/hooks/use-bible"
import { songStanzaToRenderData } from "@/lib/song-to-render"
import type { QueueItem, Verse } from "@/types"

function QueueItemCard({
  item,
  index,
  isActive,
}: {
  item: QueueItem
  index: number
  isActive: boolean
}) {
  const handlePresent = () => {
    useQueueStore.getState().setActive(index)
    if (item.kind === "song-stanza") {
      const song = useSongStore.getState().getSong(item.songId)
      const render = songStanzaToRenderData(item, song)
      if (render) useBroadcastStore.getState().setPreviewVerse(render)
      useBroadcastStore.getState().goLive()
      return
    }
    if (item.kind === "image") {
      useBroadcastStore.getState().setFullscreenImage({ url: item.url, label: item.label })
      return
    }
    bibleActions.selectVerse(item.verse)
    const translation = useBibleStore.getState().translations
      .find(t => t.id === useBibleStore.getState().activeTranslationId)?.abbreviation ?? "KJV"
    const verseData = queueVerseToRenderData(item, translation)
    useBroadcastStore.getState().setPreviewVerse(verseData)
    useBroadcastStore.getState().goLive()
  }

  const handlePreview = () => {
    useQueueStore.getState().setActive(index)
    if (item.kind === "song-stanza") {
      const song = useSongStore.getState().getSong(item.songId)
      const render = songStanzaToRenderData(item, song)
      if (render) useBroadcastStore.getState().setPreviewVerse(render)
      return
    }
    if (item.kind === "image") {
      // Preview = stage for go-live; reuse fullscreenImage for visual feedback
      useBroadcastStore.getState().setFullscreenImage({ url: item.url, label: item.label })
      return
    }
    bibleActions.selectVerse(item.verse)
    const translation = useBibleStore.getState().translations
      .find(t => t.id === useBibleStore.getState().activeTranslationId)?.abbreviation ?? "KJV"
    const verseData = queueVerseToRenderData(item, translation)
    useBroadcastStore.getState().setPreviewVerse(verseData)
  }

  const handleRemove = () => {
    useQueueStore.getState().removeItem(item.id)
  }

  return (
    <div
      onClick={handlePreview}
      onDoubleClick={handlePresent}
      className={cn(
        "group cursor-pointer rounded-lg px-2.5 py-2 transition-colors",
        isActive
          ? "bg-primary text-primary-foreground"
          : "border border-border bg-surface-elevated hover:bg-muted/50"
      )}
    >
      {/* Reference + verse snippet in one compact row */}
      <div className="flex items-start gap-2">
        <span className={cn("text-[9px] tabular-nums pt-0.5", isActive ? "text-primary-foreground/50" : "text-muted-foreground/50")}>
          {index + 1}
        </span>
        <span className={cn("shrink-0 pt-0.5", isActive ? "text-primary-foreground/70" : "text-muted-foreground/60")} aria-hidden>
          {item.kind === "verse" ? (
            <BookOpenIcon className="size-2.5" />
          ) : item.kind === "image" ? (
            <ImageIcon className="size-2.5" />
          ) : (
            <MusicIcon className="size-2.5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <span className={cn("text-[11px] font-semibold", isActive ? "text-primary-foreground" : "text-foreground")}>
            {item.kind === "image" ? (item.label || "Image") : item.reference}
          </span>
          {item.kind === "verse" ? (
            <p className={cn(
              "line-clamp-1 font-serif text-[10px] leading-snug",
              isActive ? "text-primary-foreground/70" : "text-muted-foreground"
            )}>
              {item.chunk?.text ?? item.verse.text}
            </p>
          ) : item.kind === "image" ? (
            <div className="mt-1 flex items-center justify-center overflow-hidden rounded bg-black/40 ring-1 ring-border/40">
              <img
                src={item.thumbnailUrl ?? item.url}
                alt={item.label}
                className="max-h-32 w-auto max-w-full object-contain"
              />
            </div>
          ) : (
            <p className={cn(
              "whitespace-pre-line font-serif text-[13px] leading-relaxed",
              isActive ? "text-primary-foreground/85" : "text-foreground/80"
            )}>
              {item.text}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn(
              "opacity-0 transition-opacity group-hover:opacity-100",
              isActive ? "text-primary-foreground hover:bg-primary-foreground/20" : "hover:text-primary"
            )}
            onClick={(e) => { e.stopPropagation(); handlePresent() }}
          >
            <PlayIcon className="size-2.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn(
              "opacity-0 transition-opacity group-hover:opacity-100",
              isActive ? "text-primary-foreground hover:bg-primary-foreground/20" : "hover:text-destructive"
            )}
            onClick={(e) => { e.stopPropagation(); handleRemove() }}
          >
            <XIcon className="size-2.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}

type QueueBlock =
  | { kind: "flat"; item: QueueItem; index: number }
  | {
      kind: "group"
      groupKind: "song"
      songId: string
      firstIndex: number
      items: { item: QueueItem; index: number }[]
    }
  | {
      kind: "group"
      groupKind: "verse"
      verseGroupId: string
      firstIndex: number
      items: { item: QueueItem; index: number }[]
    }

/**
 * Build an ordered list of blocks from the flat queue. Contiguous
 * song-stanza items sharing the same songId fold into a single group;
 * verses/images and song-stanzas that don't share a neighbour stay flat.
 */
function buildBlocks(items: QueueItem[]): QueueBlock[] {
  const blocks: QueueBlock[] = []
  let i = 0
  while (i < items.length) {
    const item = items[i]

    // Song-stanza group: contiguous items sharing songId.
    if (item.kind === "song-stanza") {
      const songId = item.songId
      const groupItems: { item: QueueItem; index: number }[] = []
      const firstIndex = i
      while (i < items.length) {
        const next = items[i]
        if (next.kind !== "song-stanza" || next.songId !== songId) break
        groupItems.push({ item: next, index: i })
        i++
      }
      if (groupItems.length > 1) {
        blocks.push({ kind: "group", groupKind: "song", songId, firstIndex, items: groupItems })
      } else {
        blocks.push({ kind: "flat", item: groupItems[0].item, index: groupItems[0].index })
      }
      continue
    }

    // Verse-chunk group: contiguous chunked verses sharing chunk.groupId.
    if (item.kind === "verse" && item.chunk) {
      const groupId = item.chunk.groupId
      const groupItems: { item: QueueItem; index: number }[] = []
      const firstIndex = i
      while (i < items.length) {
        const next = items[i]
        if (next.kind !== "verse" || next.chunk?.groupId !== groupId) break
        groupItems.push({ item: next, index: i })
        i++
      }
      if (groupItems.length > 1) {
        blocks.push({ kind: "group", groupKind: "verse", verseGroupId: groupId, firstIndex, items: groupItems })
      } else {
        blocks.push({ kind: "flat", item: groupItems[0].item, index: groupItems[0].index })
      }
      continue
    }

    blocks.push({ kind: "flat", item, index: i })
    i++
  }
  return blocks
}

/** Stable key for a song group — keyed by the first stanza's item.id (UUID),
 *  so removing/reordering items elsewhere in the queue doesn't shift the key
 *  and lose the collapsed state. */
function groupKey(block: Extract<QueueBlock, { kind: "group" }>): string {
  const idPart = block.items[0].item.id
  if (block.groupKind === "song") return `song:${block.songId}:${idPart}`
  return `verse:${block.verseGroupId}:${idPart}`
}

/** Collapse keys for every song GROUP in the queue, in order. */
function groupKeys(items: QueueItem[]): string[] {
  return buildBlocks(items)
    .filter((b): b is Extract<QueueBlock, { kind: "group" }> => b.kind === "group")
    .map(groupKey)
}

function QueueGroup({
  block,
  collapsed,
  onToggle,
  activeIndex,
  isNewest,
}: {
  block: Extract<QueueBlock, { kind: "group" }>
  collapsed: boolean
  onToggle: () => void
  activeIndex: number
  isNewest: boolean
}) {
  const songTitle = useSongStore((s) =>
    block.groupKind === "song"
      ? s.songs.find((x) => x.id === block.songId)?.title ?? null
      : null,
  )
  const activeChild = block.items.find((x) => x.index === activeIndex)
  const playedCount = activeChild ? activeChild.index - block.firstIndex + 1 : 0

  const label =
    block.groupKind === "song"
      ? songTitle ?? `Song ${block.songId}`
      : stripChunkSuffix(block.items[0].item.reference)
  const Icon = block.groupKind === "song" ? MusicIcon : BookOpenIcon

  return (
    <div className="flex flex-col gap-1" data-newest-group={isNewest ? "true" : undefined}>
      <button
        onClick={onToggle}
        className={cn(
          "flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors",
          activeChild
            ? "border-red-500/40 bg-red-500/5 hover:bg-red-500/10"
            : isNewest
            ? "border-primary/30 bg-primary/5 hover:bg-primary/10"
            : "border-border bg-muted/30 hover:bg-muted/50",
        )}
      >
        <ChevronDownIcon
          className={cn("size-3 shrink-0 transition-transform", collapsed && "-rotate-90")}
        />
        <Icon className="size-3 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium">{label}</span>
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
          {activeChild ? `${playedCount}/${block.items.length}` : `${block.items.length} slides`}
        </span>
        {activeChild && (
          <span className="shrink-0 text-[9px] font-semibold text-red-500">LIVE</span>
        )}
      </button>
      {!collapsed && (
        <div className="ml-2 flex flex-col gap-1 border-l border-border pl-2">
          {block.items.map(({ item, index }) => (
            <QueueItemCard
              key={item.id}
              item={item}
              index={index}
              isActive={index === activeIndex}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Helper: drop the trailing `(N/M)` from a chunked verse's reference. */
function stripChunkSuffix(reference: string): string {
  return reference.replace(/\s*\(\d+\/\d+\)\s*$/, "").trim()
}

export function QueuePanel() {
  const items = useQueueStore((s) => s.items)
  const activeIndex = useQueueStore((s) => s.activeIndex)
  const activeTranslationId = useBibleStore((s) => s.activeTranslationId)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<Verse[]>([])
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(() => new Set())
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevGroupCountRef = useRef(0)

  // When a new song group is added (groups append to the end), collapse the
  // older groups so only the newest stays open, and scroll it into view. Saves
  // the operator from hunting/scrolling past stale expanded songs mid-service.
  useEffect(() => {
    const keys = groupKeys(items)
    if (keys.length > prevGroupCountRef.current && keys.length > 0) {
      const newest = keys[keys.length - 1]
      setCollapsedKeys(new Set(keys.filter((k) => k !== newest)))
      // Align the new group's HEADER to the top of the viewport so it starts
      // from its first stanza. Double rAF: the first frame lets the
      // collapse-others state update commit + paint (the list shrinks), the
      // second scrolls against the settled layout so the group lands at the top.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollRef.current
            ?.querySelector('[data-newest-group="true"]')
            ?.scrollIntoView({ block: "start" })
        })
      })
    }
    prevGroupCountRef.current = keys.length
  }, [items])

  const toggleCollapsed = (key: string) => {
    setCollapsedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const allGroupKeys = groupKeys(items)
  const anyExpanded = allGroupKeys.some((k) => !collapsedKeys.has(k))
  const toggleCollapseAll = () => {
    setCollapsedKeys(anyExpanded ? new Set(allGroupKeys) : new Set())
  }

  const handleSearch = async () => {
    if (searchQuery.trim().length < 2) return
    try {
      const results = await invoke<Verse[]>("search_verses", {
        query: searchQuery.trim(),
        translationId: activeTranslationId,
        limit: 6,
      })
      setSearchResults(results)
    } catch {
      setSearchResults([])
    }
  }

  const addVerseToQueue = (verse: Verse) => {
    const firstInsertedIndex = useQueueStore.getState().items.length
    const inserted = useQueueStore.getState().addItem({
      kind: "verse",
      id: crypto.randomUUID(),
      verse,
      reference: `${verse.book_name} ${verse.chapter}:${verse.verse}`,
      confidence: 1,
      source: "manual",
      added_at: Date.now(),
    })
    useQueueStore.getState().setActive(firstInsertedIndex)
    const first = inserted[0]
    if (first?.kind === "verse") {
      const translation = useBibleStore.getState().translations
        .find(t => t.id === useBibleStore.getState().activeTranslationId)?.abbreviation ?? "KJV"
      useBroadcastStore.getState().setPreviewVerse(queueVerseToRenderData(first, translation))
    }
    setSearchResults([])
    setSearchQuery("")
  }

  return (
    <div
      data-slot="queue-panel"
      className="flex h-full min-w-0 flex-col overflow-hidden bg-card"
    >
      <PanelHeader title="Queue">
        <div className="flex items-center gap-2">
          <Badge variant="outline">{items.length}</Badge>
          {allGroupKeys.length > 0 && (
            <button
              onClick={toggleCollapseAll}
              className="text-[0.625rem] text-muted-foreground transition-colors hover:text-foreground"
            >
              {anyExpanded ? "Collapse all" : "Expand all"}
            </button>
          )}
          {items.length > 0 && (
            <button
              onClick={() => useQueueStore.getState().clearQueue()}
              className="text-[0.625rem] text-muted-foreground transition-colors hover:text-foreground"
            >
              Clear all
            </button>
          )}
        </div>
      </PanelHeader>

      {/* Quick add search */}
      <div className="flex shrink-0 gap-1 border-b border-border p-1.5">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Add verse..."
            className="h-7 pl-7 text-[11px]"
          />
        </div>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={handleSearch}>
          <PlusIcon className="size-3" />
        </Button>
      </div>

      {/* Search results */}
      {searchResults.length > 0 && (
        <div className="shrink-0 border-b border-border bg-muted/20">
          <div className="max-h-32 overflow-y-auto">
            {searchResults.map((verse) => (
              <button
                key={verse.id}
                onClick={() => addVerseToQueue(verse)}
                className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/50"
              >
                <span className="shrink-0 text-[10px] font-semibold text-primary">
                  {verse.book_name} {verse.chapter}:{verse.verse}
                </span>
                <span className="line-clamp-1 font-serif text-[10px] text-muted-foreground">
                  {verse.text}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-1.5 p-2">
          {items.length === 0 && (
            <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
              <div className="flex size-10 items-center justify-center rounded-full bg-muted/50">
                <ListIcon className="size-5 text-muted-foreground/60" />
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-xs font-medium text-muted-foreground">Queue is empty</p>
                <p className="text-[0.625rem] leading-relaxed text-muted-foreground/60">
                  Search above to add verses, or they'll appear here from detections during the service.
                </p>
              </div>
            </div>
          )}
          {buildBlocks(items).map((block) => {
            if (block.kind === "flat") {
              return (
                <QueueItemCard
                  key={block.item.id}
                  item={block.item}
                  index={block.index}
                  isActive={block.index === activeIndex}
                />
              )
            }
            const key = groupKey(block)
            return (
              <QueueGroup
                key={key}
                block={block}
                collapsed={collapsedKeys.has(key)}
                onToggle={() => toggleCollapsed(key)}
                activeIndex={activeIndex}
                isNewest={key === allGroupKeys[allGroupKeys.length - 1]}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
