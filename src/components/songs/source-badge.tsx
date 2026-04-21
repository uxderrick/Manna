import { HYMNAL_BADGES, isHymnalSource } from "@/types"
import type { SongSource } from "@/types"
import { cn } from "@/lib/utils"

export function SourceBadge({ source, className }: { source: SongSource; className?: string }) {
  if (!isHymnalSource(source)) return null
  return (
    <span
      className={cn(
        "rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tabular-nums text-muted-foreground",
        className,
      )}
    >
      {HYMNAL_BADGES[source]}
    </span>
  )
}
