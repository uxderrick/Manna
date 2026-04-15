import { useEffect, useRef } from "react"
import { AudioLinesIcon } from "lucide-react"
import { invoke } from "@tauri-apps/api/core"
import {
  useTranscriptStore,
  useAudioStore,
  useDetectionStore,
  useBibleStore,
  useBroadcastStore,
  useSessionStore,
  useSettingsStore,
} from "@/stores"
import { useTauriEvent } from "@/hooks/use-tauri-event"
import { bibleActions } from "@/hooks/use-bible"
import { toVerseRenderData, retranslateBroadcastVerses } from "@/hooks/use-broadcast"
import type { TranscriptSegment } from "@/types"
import type { DetectionResult } from "@/types"

// Auto-broadcast cooldown — prevents rapid flickering between verses
let lastAutoBroadcastAt = 0

export function TranscriptPanel() {
  const segments = useTranscriptStore((s) => s.segments)
  const currentPartial = useTranscriptStore((s) => s.currentPartial)
  const isTranscribing = useTranscriptStore((s) => s.isTranscribing)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Listen for Tauri events
  useTauriEvent<{ rms: number; peak: number }>("audio_level", (payload) => {
    useAudioStore.getState().setLevel(payload)
  })

  // Connection status events.
  // `stt_reconnecting` fires on transient drops (e.g. Deepgram silence timeout).
  // Only `stt_error` and terminal `stt_disconnected` flip `isTranscribing` off.
  useTauriEvent("stt_connected", () => {
    useTranscriptStore.getState().setConnectionStatus("connected")
    useTranscriptStore.getState().setTranscribing(true)
  })
  useTauriEvent("stt_reconnecting", () => {
    useTranscriptStore.getState().setConnectionStatus("reconnecting")
  })
  useTauriEvent("stt_disconnected", () => {
    useTranscriptStore.getState().setConnectionStatus("disconnected")
    useTranscriptStore.getState().setTranscribing(false)
    useTranscriptStore.getState().setPartial("")
  })
  useTauriEvent<string>("stt_error", () => {
    useTranscriptStore.getState().setConnectionStatus("error")
    useTranscriptStore.getState().setTranscribing(false)
    useTranscriptStore.getState().setPartial("")
  })

  useTauriEvent<{ text: string; is_final: boolean; confidence: number }>(
    "transcript_partial",
    (payload) => {
      useTranscriptStore.getState().setPartial(payload.text)
    }
  )

  useTauriEvent<{ text: string; is_final: boolean; confidence: number }>(
    "transcript_final",
    (payload) => {
      const segment: TranscriptSegment = {
        id: crypto.randomUUID(),
        text: payload.text,
        is_final: true,
        confidence: payload.confidence,
        words: [],
        timestamp: Date.now(),
      }
      useTranscriptStore.getState().addSegment(segment)

      // Record transcript to active session
      const activeSession = useSessionStore.getState().activeSession
      if (activeSession && activeSession.status === "live") {
        invoke("add_session_transcript", {
          request: {
            sessionId: activeSession.id,
            text: payload.text,
            isFinal: true,
            confidence: payload.confidence || null,
            timestampMs: Date.now(),
            speakerLabel: null,
          }
        }).catch(() => {})
      }
    }
  )

  // Listen for voice translation commands: "read in NIV", "switch to ESV"
  useTauriEvent<{ abbreviation: string; translation_id: number }>(
    "translation_command",
    (data) => {
      useBibleStore.getState().setActiveTranslation(data.translation_id)
      retranslateBroadcastVerses(data.translation_id, data.abbreviation).catch(() => {})
      console.log(`[VOICE] Translation switched to ${data.abbreviation}`)
    }
  )

  // Listen for detection results from the backend (batch replaces previous detections)
  useTauriEvent<DetectionResult[]>("verse_detections", (detections) => {
    useDetectionStore.getState().addDetections(detections)

    // Record detections to active session
    const activeSession = useSessionStore.getState().activeSession
    if (activeSession && activeSession.status === "live") {
      for (const d of detections) {
        invoke("add_session_detection", {
          request: {
            sessionId: activeSession.id,
            verseRef: d.verse_ref,
            verseText: d.verse_text || "",
            translation: useBibleStore.getState().translations
              .find(t => t.id === useBibleStore.getState().activeTranslationId)?.abbreviation ?? "KJV",
            confidence: d.confidence,
            source: d.source,
            transcriptSnippet: d.transcript_snippet || null,
          }
        }).catch(() => {})
      }
    }

    // Auto-add high-confidence detections (99%+) to history
    // These are near-certain matches the pastor explicitly referenced
    for (const d of detections) {
      if (d.confidence >= 0.99 && d.book_number > 0) {
        const trans = useBibleStore.getState().translations
          .find(t => t.id === useBibleStore.getState().activeTranslationId)?.abbreviation ?? "KJV"
        const verseData = {
          reference: `${d.book_name} ${d.chapter}:${d.verse} (${trans})`,
          segments: [{ text: d.verse_text || "" }],
        }
        const { history } = useBroadcastStore.getState()
        const lastRef = history[0]?.verse.reference
        if (lastRef !== verseData.reference) {
          useBroadcastStore.setState({
            history: [{ verse: verseData, presentedAt: Date.now() }, ...history].slice(0, 50)
          })
        }
      }
    }

    // Auto-navigate book search + select verse for preview/live
    // Handle direct, contextual (reading mode), and high-confidence quotation matches
    const directHit = detections.find(
      (d) => d.source === "direct" || d.source === "contextual" || (d.source === "quotation" && d.auto_queued)
    )
    if (directHit && directHit.book_number > 0) {
      // Select verse immediately so preview/live panels update
      bibleActions.selectVerse({
        id: 0,
        translation_id: useBibleStore.getState().activeTranslationId,
        book_number: directHit.book_number,
        book_name: directHit.book_name,
        book_abbreviation: "",
        chapter: directHit.chapter,
        verse: directHit.verse,
        text: directHit.verse_text,
      })
      // Navigate book search panel to this verse
      useBibleStore
        .getState()
        .setPendingNavigation({
          bookNumber: directHit.book_number,
          chapter: directHit.chapter,
          verse: directHit.verse,
        })
    }

    // ── Auto-broadcast mode ──────────────────────────────────────
    const { autoMode, confidenceThreshold, cooldownMs } = useSettingsStore.getState()
    if (autoMode) {
      const now = Date.now()
      if (now - lastAutoBroadcastAt < cooldownMs) return // cooldown active

      // Find the best detection that meets the threshold
      const best = detections
        .filter((d) => d.confidence >= confidenceThreshold && d.book_number > 0)
        .sort((a, b) => b.confidence - a.confidence)[0]

      if (best) {
        lastAutoBroadcastAt = now
        const verse = {
          id: 0,
          translation_id: useBibleStore.getState().activeTranslationId,
          book_number: best.book_number,
          book_name: best.book_name,
          book_abbreviation: "",
          chapter: best.chapter,
          verse: best.verse,
          text: best.verse_text,
        }
        const trans = useBibleStore.getState().translations
          .find((t) => t.id === useBibleStore.getState().activeTranslationId)?.abbreviation ?? "KJV"
        // Push directly to live screen — skip preview in auto mode
        useBroadcastStore.getState().setLiveVerse(toVerseRenderData(verse, trans))
      }
    }
  })

  // On mount (including hot reload), reset backend transcription state
  // so stale stt_active flags don't block "Start transcribing"
  useEffect(() => {
    invoke("stop_transcription").catch(() => {})
  }, [])

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [segments, currentPartial])

  return (
    <div
      data-slot="transcript-panel"
      className="flex h-full min-w-0 flex-col overflow-hidden bg-card"
    >
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-2 p-3">
          {/* Faded top gradient */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-linear-to-b from-card to-transparent" />

          {segments.length === 0 && !currentPartial && !isTranscribing && (
            <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
              <div className="flex size-10 items-center justify-center rounded-full bg-muted/50">
                <AudioLinesIcon className="size-5 text-muted-foreground/60" />
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-xs font-medium text-muted-foreground">No transcript yet</p>
                <p className="text-[0.625rem] leading-relaxed text-muted-foreground/60">
                  Click &ldquo;Start transcribing&rdquo; in the toolbar to begin capturing the sermon.
                </p>
              </div>
            </div>
          )}

          {/* Final segments — recent ones brighter, older ones fade */}
          {segments.map((seg, idx) => {
            const distFromEnd = segments.length - 1 - idx
            const opacity =
              distFromEnd === 0
                ? "text-foreground/80"
                : distFromEnd === 1
                  ? "text-foreground/60"
                  : distFromEnd <= 3
                    ? "text-foreground/40"
                    : "text-foreground/25"
            return (
              <p
                key={seg.id}
                className={`text-sm leading-relaxed transition-colors duration-300 ${opacity}`}
              >
                {seg.text}
              </p>
            )
          })}

          {/* Partial (in-progress) text — larger and brighter than final segments */}
          {currentPartial && (
            <p className="border-l-2 border-primary pl-2 text-base leading-relaxed text-foreground">
              {currentPartial}
              <span className="ml-1 inline-block size-1.5 animate-pulse rounded-full bg-primary align-middle" />
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
