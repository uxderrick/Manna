import { PanelHeader } from "@/components/ui/panel-header"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { PlayIcon, ClockIcon } from "lucide-react"
import { useBroadcastStore, useBibleStore } from "@/stores"
import { toVerseRenderData } from "@/hooks/use-broadcast"

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.floor(minutes / 60)}h ago`
}

function HistoryItem({
  verse,
  presentedAt,
  isCurrentlyLive,
}: {
  verse: { reference: string; segments: Array<{ text: string }> }
  presentedAt: number
  isCurrentlyLive: boolean
}) {
  const handleRePresent = () => {
    useBroadcastStore.getState().setPreviewVerse(verse)
    useBroadcastStore.getState().goLive()
  }

  const verseText = verse.segments.map((s) => s.text).join(" ")

  return (
    <div
      className={cn(
        "group cursor-pointer rounded-lg px-2.5 py-2 transition-colors",
        isCurrentlyLive
          ? "bg-primary text-primary-foreground"
          : "hover:bg-muted/50"
      )}
      onClick={handleRePresent}
    >
      <div className="flex items-center justify-between">
        <span className={cn(
          "text-[11px] font-semibold",
          isCurrentlyLive ? "text-primary-foreground" : "text-foreground"
        )}>
          {verse.reference}
        </span>
        <div className="flex items-center gap-1.5">
          <span className={cn(
            "text-[9px]",
            isCurrentlyLive ? "text-primary-foreground/60" : "text-muted-foreground"
          )}>
            {formatTimeAgo(presentedAt)}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn(
              "opacity-0 transition-opacity group-hover:opacity-100",
              isCurrentlyLive ? "text-primary-foreground hover:bg-primary-foreground/20" : "hover:text-primary"
            )}
            onClick={(e) => { e.stopPropagation(); handleRePresent() }}
          >
            <PlayIcon className="size-2.5" />
          </Button>
        </div>
      </div>
      <p className={cn(
        "line-clamp-1 font-serif text-[10px] leading-snug",
        isCurrentlyLive ? "text-primary-foreground/70" : "text-muted-foreground"
      )}>
        {verseText}
      </p>
    </div>
  )
}

export function HistoryPanel() {
  const history = useBroadcastStore((s) => s.history)
  const liveVerse = useBroadcastStore((s) => s.liveVerse)

  return (
    <div
      data-slot="history-panel"
      className="flex h-full min-w-0 flex-col overflow-hidden bg-card"
    >
      <PanelHeader title="History">
        <div className="flex items-center gap-2">
          <ClockIcon className="size-3 text-muted-foreground" />
          {history.length > 0 && (
            <span className="text-[0.625rem] text-muted-foreground">{history.length} verses</span>
          )}
        </div>
      </PanelHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-0.5 p-2">
          {history.length === 0 && (
            <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
              <div className="flex size-10 items-center justify-center rounded-full bg-muted/50">
                <ClockIcon className="size-5 text-muted-foreground/60" />
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-xs font-medium text-muted-foreground">No history yet</p>
                <p className="text-[0.625rem] leading-relaxed text-muted-foreground/60">
                  Verses you present will appear here so you can quickly go back to them.
                </p>
              </div>
            </div>
          )}
          {history.map((item, idx) => (
            <HistoryItem
              key={`${item.verse.reference}-${item.presentedAt}`}
              verse={item.verse}
              presentedAt={item.presentedAt}
              isCurrentlyLive={liveVerse?.reference === item.verse.reference}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
