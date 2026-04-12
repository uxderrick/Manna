import { PanelHeader } from "@/components/ui/panel-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  PlayIcon,
  XIcon,
} from "lucide-react"
import { useQueueStore, useBroadcastStore, useBibleStore } from "@/stores"
import { toVerseRenderData } from "@/hooks/use-broadcast"
import { bibleActions } from "@/hooks/use-bible"
import type { QueueItem } from "@/types"

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
    bibleActions.selectVerse(item.verse)
    const translation = useBibleStore.getState().translations
      .find(t => t.id === useBibleStore.getState().activeTranslationId)?.abbreviation ?? "KJV"
    const verseData = toVerseRenderData(item.verse, translation)
    useBroadcastStore.getState().setPreviewVerse(verseData)
    useBroadcastStore.getState().goLive()
  }

  const handlePreview = () => {
    useQueueStore.getState().setActive(index)
    bibleActions.selectVerse(item.verse)
    const translation = useBibleStore.getState().translations
      .find(t => t.id === useBibleStore.getState().activeTranslationId)?.abbreviation ?? "KJV"
    useBroadcastStore.getState().setPreviewVerse(toVerseRenderData(item.verse, translation))
  }

  const handleRemove = () => {
    useQueueStore.getState().removeItem(item.id)
  }

  return (
    <div
      onClick={handlePreview}
      className={cn(
        "group cursor-pointer rounded-xl p-3 transition-colors",
        isActive
          ? "bg-primary text-primary-foreground"
          : "border border-border bg-surface-elevated hover:bg-muted/50"
      )}
    >
      {/* Header: reference + order number */}
      <div className="flex items-center justify-between">
        <span className={cn("text-xs font-semibold", isActive ? "text-primary-foreground" : "text-foreground")}>
          {item.reference}
        </span>
        <div className="flex items-center gap-1">
          <span className={cn("text-[9px] tabular-nums", isActive ? "text-primary-foreground/60" : "text-muted-foreground")}>
            {index + 1}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn(
              "opacity-0 transition-opacity group-hover:opacity-100",
              isActive ? "hover:bg-primary-foreground/20 text-primary-foreground" : "hover:bg-destructive/10 hover:text-destructive"
            )}
            onClick={(e) => { e.stopPropagation(); handleRemove() }}
          >
            <XIcon className="size-2.5" />
          </Button>
        </div>
      </div>

      {/* Verse text preview */}
      <p className={cn(
        "mt-1 line-clamp-2 font-serif text-[11px] leading-relaxed",
        isActive ? "text-primary-foreground/80" : "text-muted-foreground"
      )}>
        {item.verse.text}
      </p>

      {/* Action buttons — show on hover for non-active, always for active */}
      <div className={cn(
        "mt-2 flex gap-1.5 transition-opacity",
        isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
      )}>
        <Button
          size="xs"
          className={cn(
            "gap-1 rounded-full px-2.5 text-[10px]",
            isActive
              ? "bg-primary-foreground text-primary hover:bg-primary-foreground/90"
              : ""
          )}
          onClick={(e) => { e.stopPropagation(); handlePresent() }}
        >
          <PlayIcon className="size-2.5" />
          Go Live
        </Button>
      </div>
    </div>
  )
}

export function QueuePanel() {
  const items = useQueueStore((s) => s.items)
  const activeIndex = useQueueStore((s) => s.activeIndex)

  return (
    <div
      data-slot="queue-panel"
      className="flex h-full min-w-0 flex-col overflow-hidden bg-card"
    >
      <PanelHeader title="Queue">
        <div className="flex items-center gap-2">
          <Badge variant="outline">{items.length}</Badge>
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-1.5 p-2">
          {items.length === 0 && (
            <p className="p-4 text-center text-xs text-muted-foreground">
              Verses will appear here when detected or queued
            </p>
          )}
          {items.map((item, idx) => (
            <QueueItemCard
              key={item.id}
              item={item}
              index={idx}
              isActive={idx === activeIndex}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
