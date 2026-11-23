import {
  PlayIcon,
  PlusIcon,
  CalendarPlusIcon,
  Trash2Icon,
  DownloadIcon,
  CheckIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { MediaHit } from "../(lib)/media"

export function MediaTile({
  hit,
  saved,
  onGoLive,
  onEnqueue,
  onAddToPlan,
  onDownload,
  onDelete,
}: {
  hit: MediaHit
  saved?: boolean
  onGoLive: () => void
  onEnqueue: () => void
  onAddToPlan: () => void
  onDownload?: () => void
  onDelete?: () => void
}) {
  return (
    <li className="group relative overflow-hidden rounded bg-muted/30 ring-1 ring-border/40">
      <div className="aspect-video overflow-hidden">
        {hit.mediaType === "video" && hit.thumbnailUrl === hit.url ? (
          <video
            src={hit.url}
            muted
            playsInline
            preload="metadata"
            className="size-full object-cover"
            aria-label={hit.label}
          />
        ) : (
          <img
            src={hit.thumbnailUrl}
            alt={hit.label}
            loading="lazy"
            className="size-full object-cover"
          />
        )}
      </div>
      {hit.mediaType && (
        <span className="absolute top-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
          {hit.mediaType === "youtube" ? "YouTube" : "Loop"}
        </span>
      )}
      <div className="absolute top-1 right-1 flex items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <span className="rounded bg-black/55 px-1 py-px text-[7px] font-semibold tracking-wide text-white uppercase">
          {hit.provider}
        </span>
        {onDownload && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              if (!saved) onDownload()
            }}
            disabled={saved}
            className={cn(
              "rounded p-0.5 text-white transition-colors",
              saved
                ? "cursor-default bg-emerald-600/85"
                : "bg-black/70 hover:bg-primary"
            )}
            title={saved ? "Saved to library" : "Save to library"}
          >
            {saved ? (
              <CheckIcon className="size-2.5" />
            ) : (
              <DownloadIcon className="size-2.5" />
            )}
          </button>
        )}
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            className="rounded bg-destructive/85 p-0.5 text-white hover:bg-destructive"
            title={
              hit.mediaType === "youtube" ? "Remove link" : "Delete from disk"
            }
          >
            <Trash2Icon className="size-2.5" />
          </button>
        )}
      </div>
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-black/85 to-transparent p-1.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <p className="truncate text-xs text-white">{hit.label}</p>
        <div className="flex gap-1">
          <Button
            size="xs"
            variant="default"
            onClick={onGoLive}
            className="h-6 flex-1 gap-1 px-1 text-[9px]"
            title="Broadcast immediately"
            aria-label={`Show ${hit.label} live`}
          >
            <PlayIcon className="size-2.5" />
            Live
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={onEnqueue}
            className="h-6 gap-1 px-1.5 text-[9px]"
            title="Add to queue"
            aria-label={`Queue ${hit.label}`}
          >
            <PlusIcon className="size-2.5" />
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={onAddToPlan}
            className="h-6 gap-1 px-1.5 text-[9px]"
            title="Add to plan"
            aria-label={`Add ${hit.label} to plan`}
          >
            <CalendarPlusIcon className="size-2.5" />
          </Button>
        </div>
        {hit.photographer && (
          <a
            href={hit.photographerUrl ?? "#"}
            target="_blank"
            rel="noreferrer"
            className="truncate text-[8px] text-white/60 hover:text-white"
            onClick={(e) => e.stopPropagation()}
          >
            {hit.photographer}
          </a>
        )}
      </div>
    </li>
  )
}
