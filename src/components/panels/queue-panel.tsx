import { PanelHeader } from "@/components/ui/panel-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  PlayIcon,
  XIcon,
  ListIcon,
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
        <div className="min-w-0 flex-1">
          <span className={cn("text-[11px] font-semibold", isActive ? "text-primary-foreground" : "text-foreground")}>
            {item.reference}
          </span>
          <p className={cn(
            "line-clamp-1 font-serif text-[10px] leading-snug",
            isActive ? "text-primary-foreground/70" : "text-muted-foreground"
          )}>
            {item.verse.text}
          </p>
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
            <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
              <div className="flex size-10 items-center justify-center rounded-full bg-muted/50">
                <ListIcon className="size-5 text-muted-foreground/60" />
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-xs font-medium text-muted-foreground">Queue is empty</p>
                <p className="text-[0.625rem] leading-relaxed text-muted-foreground/60">
                  Verses added from detections or search will appear here for quick access during the service.
                </p>
              </div>
            </div>
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
