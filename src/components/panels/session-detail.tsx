import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ArrowLeftIcon, BookOpenIcon, MicIcon, BarChart3Icon } from "lucide-react"
import type { SessionDetection, SessionTranscriptSegment } from "@/types/session"

interface SessionDetailProps {
  sessionId: number
  sessionTitle: string
  onBack: () => void
}

type DetailTab = "detections" | "transcript" | "stats"

export function SessionDetail({ sessionId, sessionTitle, onBack }: SessionDetailProps) {
  const [tab, setTab] = useState<DetailTab>("detections")
  const [detections, setDetections] = useState<SessionDetection[]>([])
  const [transcript, setTranscript] = useState<SessionTranscriptSegment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      invoke<SessionDetection[]>("get_session_detections", { sessionId }),
      invoke<SessionTranscriptSegment[]>("get_session_transcript", { sessionId }),
    ]).then(([dets, trans]) => {
      setDetections(dets)
      setTranscript(trans)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [sessionId])

  const presentedCount = detections.filter(d => d.wasPresented).length
  const uniqueBooks = new Set(detections.map(d => d.verseRef.split(" ")[0]))

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Button variant="ghost" size="icon-xs" onClick={onBack}>
          <ArrowLeftIcon className="size-3.5" />
        </Button>
        <span className="truncate text-sm font-semibold">{sessionTitle}</span>
      </div>

      {/* Tabs */}
      <div className="flex shrink-0 gap-1 border-b border-border px-3 py-1.5">
        {(["detections", "transcript", "stats"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors ${
              tab === t
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted/50"
            }`}
          >
            {t === "detections" && <BookOpenIcon className="size-3" />}
            {t === "transcript" && <MicIcon className="size-3" />}
            {t === "stats" && <BarChart3Icon className="size-3" />}
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <p className="text-xs text-muted-foreground">Loading...</p>
          </div>
        )}

        {!loading && tab === "detections" && (
          <div className="flex flex-col gap-0.5 p-2">
            {detections.length === 0 && (
              <p className="py-8 text-center text-xs text-muted-foreground">No detections recorded</p>
            )}
            {detections.map((d, i) => (
              <div key={i} className="rounded-lg p-2 hover:bg-muted/30">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-primary">{d.verseRef}</span>
                  <span className="text-[9px] tabular-nums text-muted-foreground">{Math.round(d.confidence * 100)}%</span>
                  <Badge variant="outline" className="text-[8px]">{d.source}</Badge>
                  {d.wasPresented && <Badge className="bg-primary/15 text-[8px] text-primary">Shown</Badge>}
                </div>
                {d.verseText && (
                  <p className="mt-0.5 line-clamp-1 font-serif text-[11px] text-muted-foreground">{d.verseText}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {!loading && tab === "transcript" && (
          <div className="p-3">
            {transcript.length === 0 && (
              <p className="py-8 text-center text-xs text-muted-foreground">No transcript recorded</p>
            )}
            <div className="flex flex-col gap-2">
              {transcript.map((seg, i) => (
                <p key={i} className="text-sm leading-relaxed text-foreground/80">{seg.text}</p>
              ))}
            </div>
          </div>
        )}

        {!loading && tab === "stats" && (
          <div className="flex flex-col gap-3 p-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-muted/30 p-3">
                <p className="text-lg font-bold text-foreground">{detections.length}</p>
                <p className="text-[10px] text-muted-foreground">Detections</p>
              </div>
              <div className="rounded-lg bg-muted/30 p-3">
                <p className="text-lg font-bold text-foreground">{presentedCount}</p>
                <p className="text-[10px] text-muted-foreground">Shown on Screen</p>
              </div>
              <div className="rounded-lg bg-muted/30 p-3">
                <p className="text-lg font-bold text-foreground">{uniqueBooks.size}</p>
                <p className="text-[10px] text-muted-foreground">Books Referenced</p>
              </div>
              <div className="rounded-lg bg-muted/30 p-3">
                <p className="text-lg font-bold text-foreground">{transcript.length}</p>
                <p className="text-[10px] text-muted-foreground">Transcript Segments</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
