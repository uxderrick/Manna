import { useBroadcastStore } from "@/stores"

export function BroadcastMonitor() {
  const previewVerse = useBroadcastStore((s) => s.previewVerse)
  const liveVerse = useBroadcastStore((s) => s.liveVerse)
  const isLive = useBroadcastStore((s) => s.isLive)
  const goLive = useBroadcastStore((s) => s.goLive)
  const clearScreen = useBroadcastStore((s) => s.clearScreen)

  const previewText = previewVerse
    ? previewVerse.segments.map((seg) => seg.text).join(" ")
    : null

  const liveText = liveVerse
    ? liveVerse.segments.map((seg) => seg.text).join(" ")
    : null

  return (
    <div className="flex flex-col gap-2 border-t border-border bg-[#0d0d0c] p-2">
      {/* Preview */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[9px] font-semibold uppercase tracking-widest text-white/35">
            Preview
          </span>
          {previewVerse && (
            <button
              onClick={goLive}
              className="rounded bg-primary px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Go Live
            </button>
          )}
        </div>
        <div className="flex aspect-video items-center justify-center overflow-hidden rounded-md border border-blue-500/15 bg-gradient-to-b from-[#0a0c12] to-[#0e1220]">
          {previewVerse ? (
            <div className="flex flex-col items-center px-4 text-center">
              <p className="font-serif text-[10px] leading-relaxed text-white/80">
                {previewText}
              </p>
              <p className="mt-1.5 text-[7px] uppercase tracking-[2px] text-blue-300/40">
                {previewVerse.reference}
              </p>
            </div>
          ) : (
            <p className="px-4 text-center text-[10px] text-white/25">
              Select a verse to preview
            </p>
          )}
        </div>
      </div>

      {/* On Screen */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {isLive && (
              <div className="h-1.5 w-1.5 rounded-full bg-destructive shadow-[0_0_6px_rgba(239,68,68,0.5)]" />
            )}
            <span
              className={`text-[9px] font-semibold uppercase tracking-widest ${isLive ? "text-destructive" : "text-white/35"}`}
            >
              On Screen {isLive ? "— Live" : ""}
            </span>
          </div>
          {isLive && (
            <button
              onClick={clearScreen}
              className="rounded border border-destructive/25 bg-destructive/12 px-2 py-0.5 text-[9px] font-semibold uppercase text-destructive transition-colors hover:bg-destructive/20"
            >
              Clear
            </button>
          )}
        </div>
        <div
          className={`flex aspect-video items-center justify-center overflow-hidden rounded-md ${isLive ? "border-2 border-destructive/30 bg-gradient-to-b from-[#1a0808] to-[#120a0a]" : "border border-white/8 bg-gradient-to-b from-[#0a0a0a] to-[#12100e]"}`}
        >
          {liveVerse ? (
            <div className="flex flex-col items-center px-4 text-center">
              <p className="font-serif text-[10px] leading-relaxed text-white/85">
                {liveText}
              </p>
              <p className="mt-1.5 text-[7px] uppercase tracking-[2px] text-white/40">
                {liveVerse.reference}
              </p>
            </div>
          ) : (
            <p className="text-[10px] text-white/30">No verse on screen</p>
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
