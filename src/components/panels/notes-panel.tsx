import { useState, useEffect, useCallback } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useSessionStore } from "@/stores"
import { PanelHeader } from "@/components/ui/panel-header"
import { Badge } from "@/components/ui/badge"
import { PencilIcon, BookOpenIcon, SendIcon, StickyNoteIcon } from "lucide-react"
import type { SessionNote, SessionDetection } from "@/types/session"

type TimelineItem =
  | { kind: "note"; data: SessionNote; timestamp: number }
  | { kind: "detection"; data: SessionDetection; timestamp: number }

function formatTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

export function NotesPanel() {
  const activeSession = useSessionStore((s) => s.activeSession)
  const [input, setInput] = useState("")
  const [notes, setNotes] = useState<SessionNote[]>([])
  const [detections, setDetections] = useState<SessionDetection[]>([])
  const [submitting, setSubmitting] = useState(false)

  const sessionId = activeSession?.id

  const loadData = useCallback(async () => {
    if (!sessionId) return
    const [n, d] = await Promise.all([
      invoke<SessionNote[]>("get_session_notes", { sessionId }),
      invoke<SessionDetection[]>("get_session_detections", { sessionId }),
    ])
    setNotes(n)
    setDetections(d)
  }, [sessionId])

  useEffect(() => {
    setNotes([])
    setDetections([])
    loadData()
  }, [loadData])

  // Poll for updates while session is active
  useEffect(() => {
    if (!sessionId) return
    const interval = setInterval(loadData, 5000)
    return () => clearInterval(interval)
  }, [sessionId, loadData])

  const handleSubmit = async () => {
    if (!sessionId || !input.trim()) return
    setSubmitting(true)
    try {
      await invoke("add_session_note", {
        request: { sessionId, noteType: "manual", content: input.trim() },
      })
      setInput("")
      await loadData()
    } finally {
      setSubmitting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  if (!activeSession) {
    return (
      <div className="flex h-full flex-col">
        <PanelHeader title="Notes" icon={<StickyNoteIcon className="size-3.5" />} />
        <div className="flex flex-1 items-center justify-center p-6">
          <p className="text-center text-xs text-muted-foreground">
            Start a service to begin taking notes
          </p>
        </div>
      </div>
    )
  }

  // Interleave notes and detections by timestamp, newest first
  const timeline: TimelineItem[] = [
    ...notes.map((n) => ({
      kind: "note" as const,
      data: n,
      timestamp: new Date(n.createdAt).getTime(),
    })),
    ...detections.map((d) => ({
      kind: "detection" as const,
      data: d,
      timestamp: new Date(d.detectedAt).getTime(),
    })),
  ].sort((a, b) => b.timestamp - a.timestamp)

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Notes" icon={<StickyNoteIcon className="size-3.5" />} />

      {/* Input */}
      <div className="shrink-0 border-b border-border p-2">
        <div className="flex items-center gap-1.5 rounded-full border border-border bg-muted/30 px-3 py-1">
          <input
            type="text"
            className="min-w-0 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
            placeholder="Add a note..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={submitting}
          />
          <button
            onClick={handleSubmit}
            disabled={submitting || !input.trim()}
            className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:text-primary disabled:opacity-40"
          >
            <SendIcon className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Timeline */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {timeline.length === 0 && (
          <p className="py-8 text-center text-xs text-muted-foreground">
            No notes or detections yet
          </p>
        )}

        <div className="flex flex-col gap-1 p-2">
          {timeline.map((item) => {
            if (item.kind === "note") {
              const note = item.data
              return (
                <div
                  key={`note-${note.id}`}
                  className="rounded-lg bg-muted/30 p-2.5"
                >
                  <div className="flex items-start gap-2">
                    <PencilIcon className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs leading-relaxed text-foreground">
                        {note.content}
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {formatTime(note.createdAt)}
                      </p>
                    </div>
                  </div>
                </div>
              )
            }

            const det = item.data
            return (
              <div
                key={`det-${det.id}`}
                className="rounded-lg bg-primary/5 p-2.5"
              >
                <div className="flex items-start gap-2">
                  <BookOpenIcon className="mt-0.5 size-3 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-primary">
                        {det.verseRef}
                      </span>
                      <Badge
                        variant="outline"
                        className="text-[8px] tabular-nums"
                      >
                        {Math.round(det.confidence * 100)}%
                      </Badge>
                      {det.wasPresented && (
                        <Badge className="bg-primary/15 text-[8px] text-primary">
                          Shown
                        </Badge>
                      )}
                    </div>
                    {det.verseText && (
                      <p className="mt-0.5 line-clamp-2 font-serif text-[11px] leading-relaxed text-muted-foreground">
                        {det.verseText}
                      </p>
                    )}
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {formatTime(det.detectedAt)}
                    </p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
