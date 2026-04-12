import { useBroadcastStore, useBibleStore } from "@/stores"
import { toVerseRenderData } from "@/hooks/use-broadcast"
import { invoke } from "@tauri-apps/api/core"
import type { Verse } from "@/types"

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

  // Parse book/chapter/verse from the reference string (e.g., "Genesis 1:3 (KJV)")
  const parseRef = (ref: string) => {
    const match = ref.match(/^(.+?)\s+(\d+):(\d+)/)
    if (!match) return null
    return { bookName: match[1], chapter: parseInt(match[2]), verse: parseInt(match[3]) }
  }

  const stepVerse = async (delta: number) => {
    // Use whichever is showing — live verse takes priority, otherwise preview
    const current = isLive ? liveVerse : previewVerse
    if (!current) return

    const parsed = parseRef(current.reference)
    if (!parsed) return

    const targetVerse = parsed.verse + delta
    if (targetVerse < 1) return

    const translationId = useBibleStore.getState().activeTranslationId
    const books = useBibleStore.getState().books
    const book = books.find(b => b.name === parsed.bookName)
    if (!book) return

    try {
      const verse = await invoke<Verse | null>("get_verse", {
        translationId,
        bookNumber: book.book_number,
        chapter: parsed.chapter,
        verse: targetVerse,
      })
      if (!verse) return

      const trans = useBibleStore.getState().translations
        .find(t => t.id === translationId)?.abbreviation ?? "KJV"
      const verseData = toVerseRenderData(verse, trans)

      if (isLive) {
        useBroadcastStore.getState().setPreviewVerse(verseData)
        useBroadcastStore.getState().goLive()
      } else {
        useBroadcastStore.getState().setPreviewVerse(verseData)
      }
    } catch {
      // verse doesn't exist (end of chapter)
    }
  }

  const hasVerse = previewVerse || liveVerse

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
      <div className="flex items-center gap-1">
        <button
          onClick={() => stepVerse(-1)}
          disabled={!hasVerse}
          className="flex-1 rounded border border-white/8 bg-white/4 py-1 text-[9px] text-white/40 transition-colors hover:bg-white/8 disabled:opacity-25"
        >
          ◀ Prev
        </button>
        <button
          onClick={() => stepVerse(1)}
          disabled={!hasVerse}
          className="flex-1 rounded border border-white/8 bg-white/4 py-1 text-[9px] text-white/40 transition-colors hover:bg-white/8 disabled:opacity-25"
        >
          Next ▶
        </button>
      </div>
    </div>
  )
}
