import { useState, useEffect } from "react"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from "@/components/ui/drawer"
import { useExportNotesDrawerStore } from "@/lib/export-notes-drawer"
import { useSession } from "@/hooks/use-session"
import { useSessionStore } from "@/stores"
import { save } from "@tauri-apps/plugin-dialog"
import type { SessionNote, SessionDetection, SessionTranscriptSegment } from "@/types/session"

interface ExportData {
  notes: SessionNote[]
  detections: SessionDetection[]
  transcript: SessionTranscriptSegment[]
}

function formatMarkdown(
  session: { title: string; date: string; speaker: string | null },
  data: ExportData,
  include: { notes: boolean; detections: boolean; transcript: boolean }
): string {
  const lines: string[] = []
  lines.push(`# Session: ${session.title}`)
  lines.push(`Date: ${session.date}${session.speaker ? ` | Speaker: ${session.speaker}` : ""}`)
  lines.push("")

  if (include.notes && data.notes.length > 0) {
    lines.push("## Notes")
    for (const note of data.notes) {
      lines.push(`- ${note.content} (${note.createdAt})`)
    }
    lines.push("")
  }

  if (include.detections && data.detections.length > 0) {
    lines.push("## Detections")
    lines.push("| Verse | Translation | Confidence | Source |")
    lines.push("|-------|------------|------------|--------|")
    for (const d of data.detections) {
      lines.push(`| ${d.verseRef} | ${d.translation} | ${Math.round(d.confidence * 100)}% | ${d.source} |`)
    }
    lines.push("")
  }

  if (include.transcript && data.transcript.length > 0) {
    lines.push("## Transcript")
    for (const seg of data.transcript) {
      const mins = Math.floor(seg.timestampMs / 60000)
      const secs = Math.floor((seg.timestampMs % 60000) / 1000)
      const ts = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
      const speaker = seg.speakerLabel ? `${seg.speakerLabel}: ` : ""
      lines.push(`[${ts}] ${speaker}${seg.text}`)
    }
    lines.push("")
  }

  return lines.join("\n")
}

function formatJson(
  data: ExportData,
  include: { notes: boolean; detections: boolean; transcript: boolean }
): string {
  const output: Record<string, unknown> = {}
  if (include.notes) output.notes = data.notes
  if (include.detections) output.detections = data.detections
  if (include.transcript) output.transcript = data.transcript
  return JSON.stringify(output, null, 2)
}

export function ExportNotesDrawer() {
  const { isOpen, sessionId, closeExportNotes } = useExportNotesDrawerStore()
  const { getNotes, getDetections, getTranscript } = useSession()
  const activeSession = useSessionStore((s) => s.activeSession)

  const [includeNotes, setIncludeNotes] = useState(true)
  const [includeDetections, setIncludeDetections] = useState(true)
  const [includeTranscript, setIncludeTranscript] = useState(false)
  const [format, setFormat] = useState<"markdown" | "json">("markdown")
  const [data, setData] = useState<ExportData>({ notes: [], detections: [], transcript: [] })
  const [isExporting, setIsExporting] = useState(false)

  useEffect(() => {
    if (!isOpen || !sessionId) return
    Promise.all([
      getNotes(sessionId).catch(() => [] as SessionNote[]),
      getDetections(sessionId).catch(() => [] as SessionDetection[]),
      getTranscript(sessionId).catch(() => [] as SessionTranscriptSegment[]),
    ]).then(([notes, detections, transcript]) => {
      setData({ notes, detections, transcript })
    })
  }, [isOpen, sessionId])

  async function handleExport() {
    if (!sessionId || !activeSession) return
    setIsExporting(true)
    try {
      const include = { notes: includeNotes, detections: includeDetections, transcript: includeTranscript }
      const content =
        format === "markdown"
          ? formatMarkdown(activeSession, data, include)
          : formatJson(data, include)

      const ext = format === "markdown" ? "md" : "json"
      const filePath = await save({
        defaultPath: `${activeSession.title.replace(/\s+/g, "-").toLowerCase()}-export.${ext}`,
        filters: [
          format === "markdown"
            ? { name: "Markdown", extensions: ["md"] }
            : { name: "JSON", extensions: ["json"] },
        ],
      })

      if (filePath) {
        const { writeTextFile } = await import("@tauri-apps/plugin-fs")
        await writeTextFile(filePath, content)
        closeExportNotes()
      }
    } finally {
      setIsExporting(false)
    }
  }

  const selectedCount = [
    includeNotes && data.notes.length,
    includeDetections && data.detections.length,
    includeTranscript && data.transcript.length,
  ].filter(Boolean)

  return (
    <Drawer open={isOpen} onOpenChange={(open) => !open && closeExportNotes()}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Export Session Notes</DrawerTitle>
          <DrawerDescription>
            Choose what to include and the output format.
          </DrawerDescription>
        </DrawerHeader>

        <div className="space-y-4 px-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Include</p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeNotes}
                onChange={(e) => setIncludeNotes(e.target.checked)}
                className="rounded"
              />
              Notes ({data.notes.length})
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeDetections}
                onChange={(e) => setIncludeDetections(e.target.checked)}
                className="rounded"
              />
              Detections ({data.detections.length})
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeTranscript}
                onChange={(e) => setIncludeTranscript(e.target.checked)}
                className="rounded"
              />
              Transcript ({data.transcript.length} segments)
            </label>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Format</p>
            <div className="flex gap-2">
              <button
                className={`rounded-md px-3 py-1.5 text-sm ${format === "markdown" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                onClick={() => setFormat("markdown")}
              >
                Markdown
              </button>
              <button
                className={`rounded-md px-3 py-1.5 text-sm ${format === "json" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                onClick={() => setFormat("json")}
              >
                JSON
              </button>
            </div>
          </div>
        </div>

        <DrawerFooter>
          <button
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            onClick={handleExport}
            disabled={isExporting || selectedCount.length === 0}
          >
            {isExporting ? "Exporting…" : "Export"}
          </button>
          <button
            className="w-full rounded-md px-4 py-2 text-sm font-medium hover:bg-muted"
            onClick={closeExportNotes}
          >
            Cancel
          </button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
