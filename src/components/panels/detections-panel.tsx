import { useEffect, useState } from "react"
import { PanelHeader } from "@/components/ui/panel-header"
import { ConfidenceDot } from "@/components/ui/confidence-dot"
import { Button } from "@/components/ui/button"
import { PlayIcon, PlusIcon, RadioIcon, ScanSearchIcon, MicIcon } from "lucide-react"
import { useDetection, detectionActions } from "@/hooks/use-detection"
import { bibleActions } from "@/hooks/use-bible"
import { useQueueStore, useBroadcastStore, useBibleStore, useTranscriptStore } from "@/stores"
import { toVerseRenderData } from "@/hooks/use-broadcast"
import { invoke } from "@tauri-apps/api/core"
import type { DetectionResult } from "@/types"

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
  const isThisLive = liveVerse?.reference?.startsWith(detection.verse_ref) ?? false
  const [verseText, setVerseText] = useState(detection.verse_text)
  const [verseInvalid, setVerseInvalid] = useState(false)

  // Fetch verse text from DB if it arrived empty (lock contention on Rust side)
  // If the verse doesn't exist in the DB, mark it as invalid to hide the card
  useEffect(() => {
    if (detection.verse_text || verseText) return
    if (detection.book_number <= 0) return
    const translationId = useBibleStore.getState().activeTranslationId
    invoke<{ text: string } | null>("get_verse", {
      translationId,
      bookNumber: detection.book_number,
      chapter: detection.chapter,
      verse: detection.verse,
    }).then((v) => {
      if (v?.text) {
        setVerseText(v.text)
      } else {
        setVerseInvalid(true)
      }
    }).catch(() => setVerseInvalid(true))
  }, [detection])

  if (verseInvalid) return null

  const handleSendToScreen = () => {
    const verse = {
      id: 0,
      translation_id: 1,
      book_number: detection.book_number,
      book_name: detection.book_name,
      book_abbreviation: "",
      chapter: detection.chapter,
      verse: detection.verse,
      text: verseText,
    }
    bibleActions.selectVerse(verse)
    if (detection.book_number > 0) {
      bibleActions.navigateToVerse(detection.book_number, detection.chapter, detection.verse)
    }
    // Send to preview monitor (not live yet — user clicks "Go Live" to push to screen)
    const translation = useBibleStore.getState().translations
      .find(t => t.id === useBibleStore.getState().activeTranslationId)?.abbreviation ?? "KJV"
    useBroadcastStore.getState().setPreviewVerse(toVerseRenderData(verse, translation))
  }

  return (
    <div className="p-1.5">
    <div className={`rounded-xl border p-3 ${isThisLive ? "border-red-500/50 bg-red-500/5" : "border-border bg-surface-elevated"}`}>
      <div className="flex items-center gap-2">
        <ConfidenceDot confidence={detection.confidence} />
        <SourceBadge source={detection.source} />
        <span className="text-sm font-semibold text-foreground">
          {detection.verse_ref}
        </span>
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

      <div className="mt-2 flex gap-1.5">
        <Button
          size="xs"
          className={`gap-1 rounded-full px-2.5 text-[10px] ${isThisLive ? "bg-red-600 text-white hover:bg-red-700" : ""}`}
          onClick={() => {
            if (!isThisLive) {
              const verse = {
                id: 0, translation_id: 1,
                book_number: detection.book_number, book_name: detection.book_name,
                book_abbreviation: "", chapter: detection.chapter,
                verse: detection.verse, text: detection.verse_text,
              }
              bibleActions.selectVerse(verse)
              if (detection.book_number > 0) {
                bibleActions.navigateToVerse(detection.book_number, detection.chapter, detection.verse)
              }
              const translation = useBibleStore.getState().translations
                .find(t => t.id === useBibleStore.getState().activeTranslationId)?.abbreviation ?? "KJV"
              // Go directly to live — skip preview to avoid race condition
              useBroadcastStore.getState().setLiveVerse(toVerseRenderData(verse, translation))
            }
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
          className="gap-1 rounded-full px-2.5 text-[10px]"
          onClick={() => {
            const verse = {
              id: 0,
              translation_id: 1,
              book_number: detection.book_number,
              book_name: detection.book_name,
              book_abbreviation: "",
              chapter: detection.chapter,
              verse: detection.verse,
              text: verseText,
            }
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
              const trans = useBibleStore.getState().translations
                .find(t => t.id === useBibleStore.getState().activeTranslationId)?.abbreviation ?? "KJV"
              useBroadcastStore.getState().setPreviewVerse(toVerseRenderData(verse, trans))
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

export function DetectionsPanel() {
  const { detections } = useDetection()
  const isTranscribing = useTranscriptStore((s) => s.isTranscribing)

  return (
    <div
      data-slot="detections-panel"
      className="flex h-full min-w-0 flex-col overflow-hidden bg-card"
    >
      <PanelHeader title="Recent detections">
        <button
          onClick={() => detectionActions.clearDetections()}
          className="text-[0.625rem] text-muted-foreground transition-colors hover:text-foreground"
        >
          Clear all
        </button>
      </PanelHeader>

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
                <p className="text-base font-bold text-foreground">Ready to begin</p>
                <p className="max-w-[220px] text-xs leading-relaxed text-muted-foreground">
                  Start a service to detect Bible verses in real time as the sermon is preached.
                </p>
              </div>
              <button
                onClick={() => {
                  const btn = document.querySelector('[data-slot="start-service-btn"]') as HTMLButtonElement
                  btn?.click()
                }}
                className="relative rounded-full bg-gradient-to-r from-primary to-primary/80 px-6 py-3 text-sm font-bold text-primary-foreground shadow-xl shadow-primary/25 transition-all hover:shadow-2xl hover:shadow-primary/35 hover:brightness-110"
              >
                Start Service
              </button>
            </div>
          )}
          {detections.length === 0 && isTranscribing && (
            <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
              <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
                <ScanSearchIcon className="size-5 animate-pulse text-primary" />
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-xs font-medium text-foreground">Listening...</p>
                <p className="text-[0.625rem] leading-relaxed text-muted-foreground">
                  Verse references will appear here as they are detected in the sermon.
                </p>
              </div>
            </div>
          )}
          {detections.map((detection, i) => (
            <DetectionCard key={`${detection.verse_ref}-${i}`} detection={detection} />
          ))}
        </div>
      </div>
    </div>
  )
}
