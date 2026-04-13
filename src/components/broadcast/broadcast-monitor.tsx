import { useState, useEffect } from "react"
import { useBroadcastStore, useBibleStore, useSessionStore } from "@/stores"
import { toVerseRenderData } from "@/hooks/use-broadcast"
import { bibleActions } from "@/hooks/use-bible"
import { invoke } from "@tauri-apps/api/core"
import { Megaphone } from "lucide-react"
import type { Verse } from "@/types"

export function BroadcastMonitor() {
  const previewVerse = useBroadcastStore((s) => s.previewVerse)
  const liveVerse = useBroadcastStore((s) => s.liveVerse)
  const isLive = useBroadcastStore((s) => s.isLive)
  const goLive = useBroadcastStore((s) => s.goLive)
  const clearScreen = useBroadcastStore((s) => s.clearScreen)
  const themes = useBroadcastStore((s) => s.themes)
  const activeThemeId = useBroadcastStore((s) => s.activeThemeId)
  const setActiveTheme = useBroadcastStore((s) => s.setActiveTheme)
  const translations = useBibleStore((s) => s.translations)
  const activeTranslationId = useBibleStore((s) => s.activeTranslationId)
  const activeSession = useSessionStore((s) => s.activeSession)

  const previewText = previewVerse
    ? previewVerse.segments.map((seg) => seg.text).join(" ")
    : null

  const liveText = liveVerse
    ? liveVerse.segments.map((seg) => seg.text).join(" ")
    : null

  // Session timer
  const [elapsed, setElapsed] = useState("00:00:00")
  useEffect(() => {
    if (!activeSession?.startedAt || activeSession.status !== "live") {
      setElapsed("00:00:00")
      return
    }
    const start = new Date(activeSession.startedAt).getTime()
    const tick = () => {
      const diff = Date.now() - start
      const h = Math.floor(diff / 3600000).toString().padStart(2, "0")
      const m = Math.floor((diff % 3600000) / 60000).toString().padStart(2, "0")
      const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, "0")
      setElapsed(`${h}:${m}:${s}`)
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [activeSession?.startedAt, activeSession?.status])

  const parseRef = (ref: string) => {
    const match = ref.match(/^(.+?)\s+(\d+):(\d+)/)
    if (!match) return null
    return { bookName: match[1], chapter: parseInt(match[2]), verse: parseInt(match[3]) }
  }

  const stepVerse = async (delta: number) => {
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

      bibleActions.selectVerse(verse)

      const trans = useBibleStore.getState().translations
        .find(t => t.id === translationId)?.abbreviation ?? "KJV"
      const verseData = toVerseRenderData(verse, trans)

      if (isLive) {
        useBroadcastStore.getState().setLiveVerse(verseData)
        try {
          const nextVerse = await invoke<Verse | null>("get_verse", {
            translationId,
            bookNumber: book.book_number,
            chapter: parsed.chapter,
            verse: targetVerse + delta,
          })
          if (nextVerse) {
            useBroadcastStore.getState().setPreviewVerse(toVerseRenderData(nextVerse, trans))
          } else {
            useBroadcastStore.getState().setPreviewVerse(null)
          }
        } catch {
          useBroadcastStore.getState().setPreviewVerse(null)
        }
      } else {
        useBroadcastStore.getState().setPreviewVerse(verseData)
      }
    } catch {
      // verse doesn't exist
    }
  }

  const hasVerse = previewVerse || liveVerse

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto bg-[#0d0d0c] p-3">
      {/* On Screen — top */}
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
          className="flex-1 rounded border border-white/8 bg-white/4 py-2 text-[10px] font-medium text-white/40 transition-colors hover:bg-white/8 disabled:opacity-25"
        >
          ◀ Prev
        </button>
        <button
          onClick={() => stepVerse(1)}
          disabled={!hasVerse}
          className="flex-1 rounded border border-white/8 bg-white/4 py-2 text-[10px] font-medium text-white/40 transition-colors hover:bg-white/8 disabled:opacity-25"
        >
          Next ▶
        </button>
      </div>

      {/* Preview — bottom */}
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

      {/* ── Quick Controls ─────────────────────────── */}
      <div className="flex flex-col gap-3 border-t border-white/6 pt-3">

        {/* Session info card */}
        {activeSession && (
          <div className="overflow-hidden rounded-lg bg-gradient-to-br from-white/[0.04] to-white/[0.02] ring-1 ring-white/[0.06]">
            <div className="flex items-center justify-between px-3 py-2.5">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-[11px] font-medium text-white/70">
                  {activeSession.title}
                </span>
                <div className="flex items-center gap-1.5">
                  {activeSession.status === "live" && (
                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.5)]" />
                  )}
                  <span className="text-[9px] capitalize text-white/30">
                    {activeSession.status}
                  </span>
                </div>
              </div>
              {activeSession.status === "live" && (
                <div className="flex flex-col items-end">
                  <span className="font-mono text-[13px] font-semibold tabular-nums text-white/50">
                    {elapsed}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Theme selector — visual grid */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[9px] font-semibold uppercase tracking-widest text-white/30">Theme</span>
          <div className="grid grid-cols-3 gap-1.5">
            {themes.map((t) => {
              const isActive = t.id === activeThemeId
              const bg = t.background
              const bgStyle: React.CSSProperties = bg.type === "gradient" && bg.gradient
                ? {
                    background: bg.gradient.type === "radial"
                      ? `radial-gradient(${bg.gradient.stops.map(s => `${s.color} ${s.position}%`).join(", ")})`
                      : `linear-gradient(${bg.gradient.angle}deg, ${bg.gradient.stops.map(s => `${s.color} ${s.position}%`).join(", ")})`,
                  }
                : { backgroundColor: bg.color }
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTheme(t.id)}
                  className={`group relative flex aspect-video flex-col items-center justify-center overflow-hidden rounded-md transition-all ${
                    isActive
                      ? "ring-2 ring-primary shadow-[0_0_8px_rgba(61,107,79,0.4)]"
                      : "ring-1 ring-white/[0.08] hover:ring-white/20"
                  }`}
                  style={bgStyle}
                >
                  {/* Mini verse preview */}
                  <span
                    className="px-1 text-center text-[5px] leading-tight"
                    style={{
                      fontFamily: t.verseText.fontFamily,
                      color: t.verseText.color,
                    }}
                  >
                    The Lord is my shepherd
                  </span>
                  <span
                    className="mt-0.5 text-[3px] uppercase tracking-widest"
                    style={{
                      fontFamily: t.reference.fontFamily,
                      color: t.reference.color,
                    }}
                  >
                    Psalm 23:1
                  </span>
                  {/* Theme name overlay */}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1 pb-0.5 pt-2">
                    <span className="text-[5px] font-medium text-white/80">{t.name}</span>
                  </div>
                  {/* Active check */}
                  {isActive && (
                    <div className="absolute right-0.5 top-0.5 flex size-3 items-center justify-center rounded-full bg-primary text-[6px] text-primary-foreground">✓</div>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Translation toggle */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[9px] font-semibold uppercase tracking-widest text-white/30">Translation</span>
          <div className="flex flex-wrap gap-1">
            {translations.slice(0, 7).map((t) => (
              <button
                key={t.id}
                onClick={async () => {
                  try {
                    await invoke("set_active_translation", { translationId: t.id })
                    useBibleStore.getState().setActiveTranslation(t.id)
                  } catch {}
                }}
                className={`rounded-full px-2.5 py-1 text-[9px] font-semibold transition-all ${
                  t.id === activeTranslationId
                    ? "bg-primary text-primary-foreground shadow-[0_0_8px_rgba(61,107,79,0.3)]"
                    : "bg-white/[0.04] text-white/35 ring-1 ring-white/[0.06] hover:bg-white/[0.08] hover:text-white/60"
                }`}
              >
                {t.abbreviation}
              </button>
            ))}
          </div>
        </div>

        {/* Announcement button */}
        <button
          onClick={() => {
            const { sendAnnouncement } = useBroadcastStore.getState()
            sendAnnouncement({
              text: "",
              position: "bottom",
              style: "info",
              duration: null,
            })
          }}
          className="group flex items-center justify-center gap-2 rounded-lg bg-white/[0.04] py-2.5 text-[11px] font-medium text-white/40 ring-1 ring-white/[0.06] transition-all hover:bg-white/[0.07] hover:text-white/70 hover:ring-white/[0.1]"
        >
          <Megaphone className="size-3.5 transition-transform group-hover:scale-110" />
          New Announcement
        </button>
      </div>
    </div>
  )
}
