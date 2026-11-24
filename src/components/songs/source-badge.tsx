import { HYMNAL_BADGES, isHymnalSource } from "@/types"
import type { SongSource } from "@/types"
import { cn } from "@/lib/utils"

const EXTRA_BADGES: Partial<Record<SongSource, string>> = {
  easyworship: "EW",
  openlp: "OLP",
  propresenter: "PP",
  ccli: "CCLI",
  custom: "CUSTOM",
}

export function SourceBadge({ source, className }: { source: SongSource; className?: string }) {
  const label = isHymnalSource(source) ? HYMNAL_BADGES[source] : EXTRA_BADGES[source]
  if (!label) return null
  return (
    <span
      className={cn(
        "rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tabular-nums text-muted-foreground",
        className,
      )}
    >
      {label}
    </span>
  )
}
