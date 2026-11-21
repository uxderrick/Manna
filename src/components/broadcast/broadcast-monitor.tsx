import { MonitorAppearanceControls } from "./monitor-appearance-controls"
import { withLiveBackground, backgroundContext } from "@/lib/live-backgrounds"
import { resolveBlankBackground } from "@/lib/brand"
import { useState, useEffect, useMemo } from "react"
import { ChevronLeftIcon, ChevronRightIcon, PauseIcon, PlayIcon, XIcon } from "lucide-react"
import { useBroadcastStore, useBibleStore, useSessionStore, useQueueStore, useSettingsStore, useSongStore } from "@/stores"
import { queueVerseToRenderData, toVerseRenderData } from "@/hooks/use-broadcast"
import { bibleActions } from "@/hooks/use-bible"
import { songStanzaToRenderData } from "@/lib/song-to-render"
import { findAdjacentBibleVerse, shouldStepWithinQueue } from "@/lib/broadcast-navigation"
import { chaptersIn } from "@/lib/bible-chapters"
import { invoke } from "@tauri-apps/api/core"
import type { TextHighlight, Verse } from "@/types"
import { CanvasVerse } from "@/components/ui/canvas-verse"
import { InteractiveVersePreview } from "@/components/panels/interactive-verse-preview"


function renderQueueItemAt(index: number) {
  const item = useQueueStore.getState().items[index]
  if (!item) return null
  if (item.kind === "song-stanza") {
    const song = useSongStore.getState().getSong(item.songId)
    return songStanzaToRenderData(item, song)
  }
  if (item.kind === "verse") {
    return queueVerseToRenderData(item)
  }
  return null
}

export function BroadcastMonitor() {
  const previewVerse = useBroadcastStore((s) => s.previewVerse)
  const liveVerse = useBroadcastStore((s) => s.liveVerse)
  const fullscreenImage = useBroadcastStore((s) => s.fullscreenImage)
  const blankLogo = useBroadcastStore((s) => s.blankLogo)
  const blankBackground = resolveBlankBackground(useSettingsStore((s) => s.brand))
  const outputHidden = useBroadcastStore((s) => s.outputHidden)
  const isLive = useBroadcastStore((s) => s.isLive)
  const goLive = useBroadcastStore((s) => s.goLive)
  const clearScreen = useBroadcastStore((s) => s.clearScreen)
  const announcement = useBroadcastStore((s) => s.announcement)
  const themes = useBroadcastStore((s) => s.themes)
  const activeThemeId = useBroadcastStore((s) => s.activeThemeId)
  const activeSession = useSessionStore((s) => s.activeSession)
  const defaultHighlightColor = useSettingsStore((s) => s.defaultHighlightColor)

  const activeTheme = themes.find((t) => t.id === activeThemeId) ?? themes[0]

  const backgrounds = useBroadcastStore((state) => state.backgrounds)
  const liveChoice = backgrounds[backgroundContext(liveVerse)]
  const previewChoice = backgrounds[backgroundContext(previewVerse)]
  const liveTheme = useMemo(() => withLiveBackground(activeTheme, liveChoice), [activeTheme, liveChoice])
  const previewTheme = useMemo(() => withLiveBackground(activeTheme, previewChoice), [activeTheme, previewChoice])

  const handleLiveHighlightsChange = (highlights: TextHighlight[]) => {
    useBroadcastStore.getState().updateLiveVerseHighlights(highlights)
    const queue = useQueueStore.getState()
    const activeItem = queue.activeIndex === null ? null : queue.items[queue.activeIndex]
    if (activeItem?.kind !== "verse" || !liveVerse) return
    if (queueVerseToRenderData(activeItem).reference === liveVerse.reference) {
      queue.updateVerseHighlights(activeItem.id, highlights)
    }
  }

  // Read the clock in a timer callback; derive the label from the active session.
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])
  const diff = activeSession?.startedAt && activeSession.status === "live"
    ? Math.max(0, now - new Date(activeSession.startedAt).getTime())
    : 0
  const elapsed = [Math.floor(diff / 3600000), Math.floor((diff % 3600000) / 60000), Math.floor((diff % 60000) / 1000)]
    .map((value) => String(value).padStart(2, "0")).join(":")

  const parseRef = (ref: string) => {
    const match = ref.match(/^(.+?)\s+(\d+):(\d+)/)
    if (!match) return null
    return { bookName: match[1], chapter: parseInt(match[2]), verse: parseInt(match[3]) }
  }

  const stepVerse = async (delta: -1 | 1) => {
    const current = isLive ? liveVerse : previewVerse
    if (!current) return

    // Queue path — advance through song stanzas and split verse chunks.
    const queue = useQueueStore.getState()
    const activeIdx = queue.activeIndex
    const activeQueueItem = activeIdx === null ? undefined : queue.items[activeIdx]
    const activeQueueRender = activeIdx === null ? null : renderQueueItemAt(activeIdx)
    if (
      activeIdx !== null &&
      shouldStepWithinQueue(activeQueueItem, current.reference, activeQueueRender?.reference)
    ) {
      const nextIdx = activeIdx + delta
      if (nextIdx < 0 || nextIdx >= queue.items.length) return
      queue.setActive(nextIdx)
      const render = renderQueueItemAt(nextIdx)
      if (render) {
        if (isLive) {
          useBroadcastStore.getState().setLiveVerse(render)
          useBroadcastStore.getState().setPreviewVerse(renderQueueItemAt(nextIdx + delta))
        } else {
          useBroadcastStore.getState().setPreviewVerse(render)
        }
      }
      return
    }

    const parsed = parseRef(current.reference)
    if (!parsed) return

    const translationId = useBibleStore.getState().activeTranslationId
    const books = useBibleStore.getState().books
    const book = books.find(b => b.name === parsed.bookName)
    if (!book) return

    try {
      const fetchVerse = ({ bookNumber, chapter, verse }: { bookNumber: number; chapter: number; verse: number }) =>
        invoke<Verse | null>("get_verse", { translationId, bookNumber, chapter, verse })
      const fetchChapter = ({ bookNumber, chapter }: { bookNumber: number; chapter: number }) =>
        invoke<Verse[]>("get_chapter", { translationId, bookNumber, chapter })

      const verse = await findAdjacentBibleVerse({
        bookNumber: book.book_number,
        chapter: parsed.chapter,
        verse: parsed.verse,
        direction: delta,
        maxChapter: chaptersIn(book.book_number),
        fetchVerse,
        fetchChapter,
      })
      if (!verse) return

      bibleActions.selectVerse(verse)
      bibleActions.navigateToVerse(verse.book_number, verse.chapter, verse.verse)

      const trans = useBibleStore.getState().translations
        .find(t => t.id === translationId)?.abbreviation ?? "KJV"
      const verseData = toVerseRenderData(verse, trans)

      if (isLive) {
        useBroadcastStore.getState().setLiveVerse(verseData)
        try {
          const nextVerse = await findAdjacentBibleVerse({
            bookNumber: book.book_number,
            chapter: verse.chapter,
            verse: verse.verse,
            direction: delta,
            maxChapter: chaptersIn(book.book_number),
            fetchVerse,
            fetchChapter,
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
    <div className="flex h-full flex-col gap-2 overflow-y-auto bg-[#0d0d0c] p-2">
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
          <div className="flex items-center gap-1">
            {announcement && <AnnouncementControl announcement={announcement} />}
            <button
              onClick={() => handleLiveHighlightsChange([])}
              disabled={!liveVerse?.highlights?.length || !!fullscreenImage || blankLogo}
              className="rounded border border-white/15 bg-white/[0.04] px-2 py-0.5 text-[9px] font-semibold uppercase text-white/60 transition-colors hover:bg-white/[0.08] disabled:opacity-25 disabled:hover:bg-white/[0.04]"
              title="Remove all highlights from the live scripture"
            >
              Clear highlights
            </button>
            <button
              onClick={() => {
                const b = useBroadcastStore.getState()
                b.setBlankLogo(true)
              }}
              className={`rounded border px-2 py-0.5 text-[9px] font-semibold uppercase transition-colors ${
                blankLogo
                  ? "border-primary/40 bg-primary/20 text-primary"
                  : "border-white/15 bg-white/[0.04] text-white/60 hover:bg-white/[0.08]"
              }`}
              title="Show blank background"
            >
              Blank
            </button>
            {isLive ? (
              <button
                onClick={clearScreen}
                className="rounded border border-destructive/25 bg-destructive/12 px-2 py-0.5 text-[9px] font-semibold uppercase text-destructive transition-colors hover:bg-destructive/20"
                title="Clear the live output and close the projector window"
              >
                Clear Output
              </button>
            ) : (
              <button
                onClick={() => useBroadcastStore.getState().showProjector()}
                className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-semibold uppercase text-emerald-400 transition-colors hover:bg-emerald-500/20"
                title="Reopen projector window on last-used monitor"
              >
                Show Projector
              </button>
            )}
          </div>
        </div>
        <div className={`overflow-hidden rounded ${isLive ? "ring-2 ring-destructive/40" : "ring-1 ring-white/[0.08]"}`}>
          {outputHidden ? <div className="aspect-video w-full bg-black" aria-label="Output hidden" /> : liveVerse && !fullscreenImage && !blankLogo ? (
            <InteractiveVersePreview
              theme={liveTheme}
              verse={liveVerse}
              defaultColor={defaultHighlightColor}
              onHighlightsChange={handleLiveHighlightsChange}
            />
          ) : (
            <CanvasVerse
              theme={liveTheme}
              verse={liveVerse}
              fullscreenImage={fullscreenImage}
              blankLogo={blankLogo}
              blankLogoUrl={blankBackground.imageUrl}
              blankVideoUrl={blankBackground.videoUrl}
              className="w-full"
            />
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => stepVerse(-1)}
          disabled={!hasVerse}
          className="flex flex-1 items-center justify-center gap-1 rounded border border-white/8 bg-white/4 py-1 text-[9px] font-medium text-white/40 transition-colors hover:bg-white/8 disabled:opacity-25"
        >
          <ChevronLeftIcon className="size-2.5" />
          Prev
        </button>
        <button
          onClick={() => stepVerse(1)}
          disabled={!hasVerse}
          className="flex flex-1 items-center justify-center gap-1 rounded border border-white/8 bg-white/4 py-1 text-[9px] font-medium text-white/40 transition-colors hover:bg-white/8 disabled:opacity-25"
        >
          Next
          <ChevronRightIcon className="size-2.5" />
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
        <div className="overflow-hidden rounded ring-1 ring-blue-500/15">
          <CanvasVerse
            theme={previewTheme}
            verse={previewVerse}
            className="w-full"
          />
        </div>
      </div>

      {/* ── Quick Controls ─────────────────────────── */}
      <div className="flex flex-col gap-2 border-t border-white/6 pt-2">

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

        <MonitorAppearanceControls />
      </div>
    </div>
  )
}


function AnnouncementControl({
  announcement,
}: {
  announcement: NonNullable<ReturnType<typeof useBroadcastStore.getState>["announcement"]>
}) {
  const [now, setNow] = useState(() => Date.now())
  const hasDuration = announcement.expiresAt != null || announcement.remainingMs != null
  useEffect(() => {
    if (!hasDuration) return
    const id = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [hasDuration])

  const remainingMs = announcement.paused
    ? announcement.remainingMs ?? 0
    : announcement.expiresAt
      ? Math.max(0, announcement.expiresAt - now)
      : null

  const secs = remainingMs != null ? Math.ceil(remainingMs / 1000) : null

  return (
    <div className="flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5">
      <span className="text-[9px] font-semibold uppercase tracking-wide text-amber-400">
        {announcement.mode === "ticker" ? "Ticker" : "Slide"}
        {secs != null && ` · ${secs}s`}
      </span>
      {hasDuration && (
        <button
          onClick={() => {
            const b = useBroadcastStore.getState()
            if (announcement.paused) b.resumeAnnouncement()
            else b.pauseAnnouncement()
          }}
          className="rounded p-0.5 text-amber-400 hover:bg-amber-500/20"
          title={announcement.paused ? "Resume announcement" : "Pause announcement"}
        >
          {announcement.paused ? <PlayIcon className="size-3" /> : <PauseIcon className="size-3" />}
        </button>
      )}
      <button
        onClick={() => useBroadcastStore.getState().dismissAnnouncement()}
        className="rounded p-0.5 text-amber-400 hover:bg-destructive/30 hover:text-destructive"
        title="Dismiss announcement"
      >
        <XIcon className="size-3" />
      </button>
    </div>
  )
}
