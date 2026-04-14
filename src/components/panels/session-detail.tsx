import { useState, useEffect, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ArrowLeftIcon, BookOpenIcon, MicIcon, BarChart3Icon, DownloadIcon, ClipboardIcon, FileTextIcon, FileJsonIcon, PrinterIcon } from "lucide-react"
import type { SessionDetection, SessionTranscriptSegment, SessionNote } from "@/types/session"

interface SessionDetailProps {
  sessionId: number
  sessionTitle: string
  onBack: () => void
}

type DetailTab = "detections" | "transcript" | "stats"

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function formatExportTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

function buildMarkdown(title: string, detections: SessionDetection[], notes: SessionNote[], transcript: SessionTranscriptSegment[]) {
  const lines: string[] = [`# ${title}`, ""]

  if (detections.length > 0) {
    lines.push("## Verses Detected", "")
    detections.forEach((d, i) => {
      const pct = Math.round(d.confidence * 100)
      const shown = d.wasPresented ? " — Shown on screen" : ""
      lines.push(`${i + 1}. ${d.verseRef} (${pct}%)${shown}`)
      if (d.verseText) lines.push(`   "${d.verseText}"`)
    })
    lines.push("")
  }

  if (notes.length > 0) {
    lines.push("## Notes", "")
    notes.forEach((n) => {
      lines.push(`- "${n.content}" (${formatExportTime(n.createdAt)})`)
    })
    lines.push("")
  }

  if (transcript.length > 0) {
    lines.push("## Transcript", "")
    lines.push(transcript.map((s) => s.text).join(" "))
    lines.push("")
  }

  return lines.join("\n")
}

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function SessionDetail({ sessionId, sessionTitle, onBack }: SessionDetailProps) {
  const [tab, setTab] = useState<DetailTab>("detections")
  const [detections, setDetections] = useState<SessionDetection[]>([])
  const [transcript, setTranscript] = useState<SessionTranscriptSegment[]>([])
  const [notes, setNotes] = useState<SessionNote[]>([])
  const [loading, setLoading] = useState(true)
  const [exportOpen, setExportOpen] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    if (!exportOpen) return
    const handler = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [exportOpen])

  useEffect(() => {
    setLoading(true)
    Promise.all([
      invoke<SessionDetection[]>("get_session_detections", { sessionId }),
      invoke<SessionTranscriptSegment[]>("get_session_transcript", { sessionId }),
      invoke<SessionNote[]>("get_session_notes", { sessionId }),
    ]).then(([dets, trans, n]) => {
      setDetections(dets)
      setTranscript(trans)
      setNotes(n)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [sessionId])

  const handleCopyClipboard = () => {
    const text = buildMarkdown(sessionTitle, detections, notes, transcript)
    navigator.clipboard.writeText(text)
    setExportOpen(false)
  }

  const handleDownloadMarkdown = () => {
    const md = buildMarkdown(sessionTitle, detections, notes, transcript)
    const slug = sessionTitle.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")
    downloadFile(md, `${slug}.md`, "text/markdown")
    setExportOpen(false)
  }

  const handleDownloadJson = () => {
    const data = { title: sessionTitle, sessionId, detections, notes, transcript }
    const slug = sessionTitle.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")
    downloadFile(JSON.stringify(data, null, 2), `${slug}.json`, "application/json")
    setExportOpen(false)
  }

  const handlePrint = () => {
    setExportOpen(false)
    window.print()
  }

  const presentedCount = detections.filter(d => d.wasPresented).length
  const uniqueBooks = new Set(detections.map(d => d.verseRef.split(" ")[0]))

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Button variant="ghost" size="icon-xs" onClick={onBack}>
          <ArrowLeftIcon className="size-3.5" />
        </Button>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{sessionTitle}</span>

        {/* Export dropdown */}
        <div className="relative" ref={exportRef}>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setExportOpen((v) => !v)}
            title="Export"
          >
            <DownloadIcon className="size-3.5" />
          </Button>
          {exportOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-lg border border-border bg-popover p-1 shadow-lg">
              <button
                onClick={handleCopyClipboard}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-muted/50"
              >
                <ClipboardIcon className="size-3.5" />
                Copy to Clipboard
              </button>
              <button
                onClick={handleDownloadMarkdown}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-muted/50"
              >
                <FileTextIcon className="size-3.5" />
                Download Markdown
              </button>
              <button
                onClick={handleDownloadJson}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-muted/50"
              >
                <FileJsonIcon className="size-3.5" />
                Download JSON
              </button>
              <button
                onClick={handlePrint}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-muted/50"
              >
                <PrinterIcon className="size-3.5" />
                Print / PDF
              </button>
            </div>
          )}
        </div>
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
