import { useBroadcastStore } from "@/stores"

export function BroadcastMonitor() {
  const activeTheme = useBroadcastStore((s) => {
    const id = s.activeThemeId
    return s.themes.find((t) => t.id === id) ?? s.themes[0]
  })
  const liveVerse = useBroadcastStore((s) => s.liveVerse)
  const isLive = useBroadcastStore((s) => s.isLive)

  // Join all segments into a single display string
  const verseText = liveVerse
    ? liveVerse.segments.map((seg) => seg.text).join(" ")
    : null

  return (
    <div className="flex flex-col gap-2 border-t border-border bg-[#0d0d0c] p-2">
      {/* Preview — next verse */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[9px] font-semibold uppercase tracking-widest text-white/35">
            Preview — Next
          </span>
          <button className="rounded bg-destructive/80 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white transition-colors hover:bg-destructive">
            Take →
          </button>
        </div>
        <div className="flex aspect-video items-center justify-center overflow-hidden rounded-md border border-white/8 bg-gradient-to-b from-[#0a0a0a] to-[#1a1a2e]">
          <p className="px-4 text-center font-serif text-[10px] leading-relaxed text-white/50">
            Select a verse to preview
          </p>
        </div>
      </div>

      {/* Program — live output */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {isLive && (
              <div className="h-1.5 w-1.5 rounded-full bg-destructive shadow-[0_0_6px_rgba(239,68,68,0.5)]" />
            )}
            <span
              className={`text-[9px] font-semibold uppercase tracking-widest ${isLive ? "text-destructive" : "text-white/35"}`}
            >
              Program {isLive ? "— Live" : ""}
            </span>
          </div>
          {isLive && (
            <button className="rounded border border-destructive/25 bg-destructive/12 px-2 py-0.5 text-[9px] font-semibold uppercase text-destructive transition-colors hover:bg-destructive/20">
              Off Air
            </button>
          )}
        </div>
        <div
          className={`flex aspect-video items-center justify-center overflow-hidden rounded-md bg-gradient-to-b from-[#0a0a0a] to-[#1a1a2e] ${isLive ? "border-2 border-destructive/30" : "border border-white/8"}`}
        >
          {liveVerse ? (
            <div className="flex flex-col items-center px-4 text-center">
              <p className="font-serif text-[10px] leading-relaxed text-white/85">
                {verseText}
              </p>
              <p className="mt-1.5 text-[7px] uppercase tracking-[2px] text-white/40">
                {liveVerse.reference}
              </p>
            </div>
          ) : (
            <p className="text-[10px] text-white/30">No verse on air</p>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex gap-1">
        <button className="flex-1 rounded border border-white/8 bg-white/4 py-1 text-[9px] text-white/40 transition-colors hover:bg-white/8">
          ◀ Prev
        </button>
        <button className="flex-1 rounded border border-white/8 bg-white/4 py-1 text-[9px] text-white/40 transition-colors hover:bg-white/8">
          Next ▶
        </button>
      </div>
    </div>
  )
}
