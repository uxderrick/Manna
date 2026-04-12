import { PanelHeader } from "@/components/ui/panel-header"
import { ConfidenceDot } from "@/components/ui/confidence-dot"
import { Button } from "@/components/ui/button"
import { PlayIcon, PlusIcon } from "lucide-react"
import { useDetection, detectionActions } from "@/hooks/use-detection"
import { bibleActions } from "@/hooks/use-bible"
import { useQueueStore, useBroadcastStore, useBibleStore } from "@/stores"
import { toVerseRenderData } from "@/hooks/use-broadcast"
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
  const handleSendToScreen = () => {
    const verse = {
      id: 0,
      translation_id: 1,
      book_number: detection.book_number,
      book_name: detection.book_name,
      book_abbreviation: "",
      chapter: detection.chapter,
      verse: detection.verse,
      text: detection.verse_text,
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
    <div className="rounded-xl border border-border bg-surface-elevated p-3">
      <div className="flex items-center gap-2">
        <ConfidenceDot confidence={detection.confidence} />
        <SourceBadge source={detection.source} />
        <span className="text-sm font-semibold text-foreground">
          {detection.verse_ref}
        </span>
      </div>

      {detection.verse_text && (
        <p className="mt-1 line-clamp-2 font-serif text-sm leading-relaxed text-muted-foreground">
          {detection.verse_text}
        </p>
      )}

      <div className="mt-2 flex gap-1.5">
        <Button size="xs" className="gap-1 rounded-full px-2.5 text-[10px]" onClick={() => { handleSendToScreen(); useBroadcastStore.getState().goLive() }}>
          <PlayIcon className="size-2.5" />
          Go Live
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
              text: detection.verse_text,
            }
            const wasEmpty = useQueueStore.getState().items.length === 0
            useQueueStore.getState().addItem({
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
          {detections.length === 0 && (
            <p className="p-4 text-center text-xs text-muted-foreground">
              Verse detections will appear here during transcription
            </p>
          )}
          {detections.map((detection, i) => (
            <DetectionCard key={`${detection.verse_ref}-${i}`} detection={detection} />
          ))}
        </div>
      </div>
    </div>
  )
}
