import { cn } from "@/lib/utils"
import type { MediaHit, OnlineFilter } from "../(lib)/media"

export function OnlineSourceFilter({
  hits,
  pexelsKey,
  unsplashKey,
  braveKey,
  onlineFilter,
  setOnlineFilter,
}: {
  hits: MediaHit[]
  pexelsKey: string | null
  unsplashKey: string | null
  braveKey: string | null
  onlineFilter: OnlineFilter
  setOnlineFilter: (filter: OnlineFilter) => void
}) {
  return (
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
  )
}
