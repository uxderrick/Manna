import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { PanelHeader } from "@/components/ui/panel-header"
import { ConfidenceDot } from "@/components/ui/confidence-dot"
import { Button } from "@/components/ui/button"
import { PlayIcon, PlusIcon, RadioIcon, ScanSearchIcon, MicIcon } from "lucide-react"
import { useDetection, detectionActions } from "@/hooks/use-detection"
import { useQueueStore, useBroadcastStore, useBibleStore, useTranscriptStore, useSessionStore } from "@/stores"
import { toVerseRenderData } from "@/hooks/use-broadcast"
import { presentQueuedVerseLive } from "@/lib/queue-verse"
import { getWorkspaceMode, getWorkspaceModeCopy } from "@/lib/workspace-mode"
import { retranslateDetections } from "@/lib/retranslate-detections"
import type { DetectionResult } from "@/types"
import { SongMatches } from "@/components/panels/song-matches"
import { useSongMatchStore, type DetectionMode, type SongModeStatus } from "@/stores/song-match-store"

const SOURCE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  direct: { bg: "bg-green-500/15", text: "text-green-600", label: "Direct" },
  contextual: { bg: "bg-blue-500/15", text: "text-blue-600", label: "Context" },
  quotation: { bg: "bg-pink-500/15", text: "text-pink-600", label: "Quote" },
  semantic_local: { bg: "bg-indigo-500/15", text: "text-indigo-300", label: "Semantic" },
  semantic_cloud: { bg: "bg-purple-500/15", text: "text-purple-300", label: "Cloud" },
}

function SourceBadge({ source }: { source: string }) {
  const style = SOURCE_COLORS[source] ?? { bg: "bg-muted", text: "text-muted-foreground", label: source }
  return (
    <span className={`rounded px-1.5 py-0.5 text-[0.5625rem] font-medium uppercase tracking-wider ${style.bg} ${style.text}`}>
      {style.label}
    </span>
  )
}

function DetectionCard({ detection }: { detection: DetectionResult }) {
  const liveVerse = useBroadcastStore((s) => s.liveVerse)
  const translations = useBibleStore((s) => s.translations)
  const activeTranslationId = useBibleStore((s) => s.activeTranslationId)
  const verseText = detection.verse_text
  const canPresent = Boolean(detection.translation_id && verseText)
  const translation = detection.translation_id
    ? translations.find((item) => item.id === detection.translation_id)?.abbreviation ?? "Unknown"
    : "Original text"
  const isThisLive = canPresent &&
    (liveVerse?.reference?.startsWith(`${detection.verse_ref} (`) ?? false) &&
    (liveVerse?.reference?.endsWith(`(${translation})`) ?? false)

  const verseFromDetection = () => ({
    id: 0,
    translation_id: detection.translation_id ?? 0,
    book_number: detection.book_number,
    book_name: detection.book_name,
    book_abbreviation: "",
    chapter: detection.chapter,
    verse: detection.verse,
    text: verseText,
  })

  const previewDetection = () => {
    if (!canPresent) return
    const verse = verseFromDetection()
    useBroadcastStore.getState().setPreviewVerse(toVerseRenderData(verse, translation))
  }

  const goLiveDetection = () => {
    if (!canPresent || isThisLive) return
    presentQueuedVerseLive(verseFromDetection(), detection.confidence)
  }

  return (
    <div className="p-1.5">
    <div
      onClick={previewDetection}
      onDoubleClick={goLiveDetection}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          if (e.shiftKey || e.metaKey || e.ctrlKey) goLiveDetection()
          else previewDetection()
        }
      }}
      title="Click to preview · Double-click to go live"
      className={`cursor-pointer select-none rounded-xl border p-3 transition-colors hover:border-primary/40 hover:bg-card/80 active:scale-[0.99] ${isThisLive ? "border-red-500/50 bg-red-500/5" : "border-border bg-surface-elevated"}`}
    >
      <div className="flex items-center gap-2">
        <ConfidenceDot confidence={detection.confidence} />
        <SourceBadge source={detection.source} />
        <span className="text-sm font-semibold text-foreground">
          {detection.verse_ref}
        </span>
        <span className="text-[0.625rem] text-muted-foreground">{translation}</span>
        <span className="text-[0.625rem] tabular-nums text-muted-foreground">
          {Math.round(detection.confidence * 100)}%
        </span>
        {isThisLive && (
          <span className="ml-auto flex items-center gap-1 rounded-full bg-red-600 px-1.5 py-0.5 text-[0.5625rem] font-semibold uppercase tracking-wider text-white">
            <RadioIcon className="size-2.5 animate-pulse" />
            Live
          </span>
        )}
      </div>

      {verseText && (
        <p className="mt-1 line-clamp-2 font-serif text-sm leading-relaxed text-muted-foreground">
          {verseText}
        </p>
      )}

      {detection.translation_id !== activeTranslationId && (
        <p className="mt-1 text-[0.625rem] text-muted-foreground">
          Showing retained text; selected translation text is not loaded.
        </p>
      )}
      <div className="mt-2 flex gap-1.5">
        <Button
          size="xs"
          disabled={!canPresent}
          className={`gap-1 rounded-full px-2.5 text-[10px] ${isThisLive ? "bg-red-600 text-white hover:bg-red-700" : ""}`}
          onClick={(e) => {
            e.stopPropagation()
            goLiveDetection()
          }}
        >
          {isThisLive ? (
            <>
              <RadioIcon className="size-2.5 animate-pulse" />
              Live
            </>
          ) : (
            <>
              <PlayIcon className="size-2.5" />
              Go Live
            </>
          )}
        </Button>
        <Button
          variant="outline"
          size="xs"
          disabled={!canPresent}
          className="gap-1 rounded-full px-2.5 text-[10px]"
          onClick={(e) => {
            e.stopPropagation()
            if (!canPresent) return
            const verse = verseFromDetection()
            const wasEmpty = useQueueStore.getState().items.length === 0
            useQueueStore.getState().addItem({
              kind: "verse",
              id: crypto.randomUUID(),
              verse,
              reference: detection.verse_ref,
              confidence: detection.confidence,
              source: detection.source === "direct" ? "ai-direct" : "ai-semantic",
              added_at: Date.now(),
            })
            if (wasEmpty) {
              useBroadcastStore.getState().setPreviewVerse(toVerseRenderData(verse, translation))
            }
          }}
        >
          <PlusIcon className="size-2.5" />
          Add to Queue
        </Button>
      </div>
    </div>
    </div>
  )
}

function ModeSwitch() {
  const mode = useSongMatchStore((s) => s.mode)
  const [busy, setBusy] = useState(false)
  const choose = async (next: DetectionMode) => {
    if (next === mode || busy) return
    setBusy(true)
    const store = useSongMatchStore.getState()
    store.setMode(next)
    try {
      const status = await invoke<SongModeStatus>("set_song_mode", { enabled: next === "songs" })
      store.setStatus(next === "songs" ? status : null)
    } catch (error) {
      console.error("Could not switch song detection", error)
      store.setMode(mode)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div data-slot="detections-mode" className="flex rounded-full border border-border p-0.5" role="radiogroup" aria-label="Detect">
      {(["verses", "songs"] as const).map((m) => (
        <button
          key={m}
          role="radio"
          aria-checked={mode === m}
          disabled={busy}
          onClick={() => void choose(m)}
          className={`rounded-full px-2 py-0.5 text-[0.625rem] font-medium capitalize transition-colors ${mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          {m}
        </button>
      ))}
    </div>
  )
}

export function DetectionsPanel() {
  const mode = useSongMatchStore((s) => s.mode)
  const { detections } = useDetection()
  // Resolve new native detections too, including payloads without translation metadata.
  useEffect(() => {
    const translationId = useBibleStore.getState().activeTranslationId
    const sessionId = useSessionStore.getState().activeSession?.id
    let cancelled = false
    void retranslateDetections(translationId, {
      isCurrent: () => !cancelled &&
        useBibleStore.getState().activeTranslationId === translationId &&
        useSessionStore.getState().activeSession?.id === sessionId,
    })
    return () => { cancelled = true }
  }, [detections])
  const isTranscribing = useTranscriptStore((s) => s.isTranscribing)
  const activeSession = useSessionStore((s) => s.activeSession)
  const pendingServiceStart = useSessionStore((s) => s.pendingServiceStart)
  const sessionsMode = useSessionStore((s) => s.sessionsMode)
  const modeCopy = getWorkspaceModeCopy(
    getWorkspaceMode({ activeSession, isTranscribing, pendingServiceStart, sessionsMode })
  )

  return (
    <div
      data-slot="detections-panel"
      className="flex h-full min-w-0 flex-col overflow-hidden bg-card"
    >
      <PanelHeader title={mode === "songs" ? "Song matches" : "Recent detections"}>
        <ModeSwitch />
        <button
          onClick={() => (mode === "songs" ? useSongMatchStore.getState().clear() : detectionActions.clearDetections())}
          className="ml-1.5 text-[0.625rem] text-muted-foreground transition-colors hover:text-foreground"
        >
          Clear all
        </button>
      </PanelHeader>

      {mode === "songs" ? <SongMatches /> : (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-0">
          {detections.length === 0 && !isTranscribing && (
            <div className="relative flex flex-1 flex-col items-center justify-center gap-6 overflow-hidden px-6 py-16 text-center">
              {/* Vibrant layered gradient background */}
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_40%,rgba(61,107,79,0.15),transparent)]" />
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_40%_40%_at_30%_60%,rgba(212,165,116,0.1),transparent)]" />
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_40%_40%_at_70%_30%,rgba(155,77,202,0.08),transparent)]" />
              </div>

              <div className="relative flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 ring-1 ring-primary/25 shadow-lg shadow-primary/10">
                <MicIcon className="size-7 text-primary" />
              </div>
              <div className="relative flex flex-col gap-2">
                <p className="text-base font-bold text-foreground">{modeCopy.detectionsEmptyTitle}</p>
                <p className="max-w-[220px] text-xs leading-relaxed text-muted-foreground">
                  {modeCopy.detectionsEmptyBody}
                </p>
              </div>
              <button
                onClick={() => {
                  const btn = document.querySelector('[data-slot="start-service-btn"]') as HTMLButtonElement
                  btn?.click()
                }}
                className="relative rounded-full bg-gradient-to-r from-primary to-primary/80 px-6 py-3 text-sm font-bold text-primary-foreground shadow-xl shadow-primary/25 transition-all hover:shadow-2xl hover:shadow-primary/35 hover:brightness-110"
              >
                {modeCopy.primaryAction}
              </button>
            </div>
          )}
          {detections.length === 0 && isTranscribing && (
            <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
              <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
                <ScanSearchIcon className="size-5 animate-pulse text-primary" />
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-xs font-medium text-foreground">{modeCopy.detectionsEmptyTitle}</p>
                <p className="text-[0.625rem] leading-relaxed text-muted-foreground">
                  {modeCopy.detectionsEmptyBody}
                </p>
              </div>
            </div>
          )}
          {detections.map((detection, i) => (
            <DetectionCard key={`${detection.verse_ref}-${i}`} detection={detection} />
          ))}
        </div>
      </div>
      )}
    </div>
  )
}
