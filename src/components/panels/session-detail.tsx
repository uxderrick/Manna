import { useState, useEffect, useRef, useMemo } from "react"
import { invoke } from "@tauri-apps/api/core"
import { save } from "@tauri-apps/plugin-dialog"
import { writeFile, writeTextFile } from "@tauri-apps/plugin-fs"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { ArrowLeftIcon, BookOpenIcon, MicIcon, BarChart3Icon, DownloadIcon, ClipboardIcon, FileTextIcon, FileJsonIcon, PrinterIcon, SparklesIcon, LoaderIcon, CopyIcon, CheckIcon, StopCircleIcon, RefreshCwIcon, SearchIcon, PencilIcon, TagIcon, XIcon, Trash2Icon, PlayIcon } from "lucide-react"
import {
  formatSummaryAsMarkdown,
  summarizeTranscript,
  summaryFromJson,
  summaryToJson,
  type SermonSummary,
} from "@/lib/summarize"
import type { SermonSession, SessionDetection, SessionTranscriptSegment, SessionNote } from "@/types/session"
import { SessionAudioPlayer } from "@/components/session-audio-player"
import { emitAudioSeek } from "@/hooks/use-audio-seek"
import {
  buildSessionExportJson,
  buildSessionExportMarkdown,
  buildSessionExportSlug,
  buildSessionPdfBytes,
} from "@/lib/session-export"

type DetailTab = "detections" | "transcript" | "summary" | "stats"

interface SessionDetailProps {
  sessionId: number
  sessionTitle: string
  initialTab?: DetailTab
  onBack: () => void
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function hasText(value: string | null | undefined) {
  return Boolean(value?.trim())
}

async function saveTextExport(content: string, defaultPath: string, filter: { name: string; extensions: string[] }) {
  const filePath = await save({
    defaultPath,
    filters: [filter],
  })
  if (!filePath) return false
  await writeTextFile(filePath, content)
  return true
}

async function saveBinaryExport(content: Uint8Array, defaultPath: string, filter: { name: string; extensions: string[] }) {
  const filePath = await save({
    defaultPath,
    filters: [filter],
  })
  if (!filePath) return false
  await writeFile(filePath, content)
  return true
}

function quoteSpeaker(quoteSpeaker: string | undefined, sessionSpeaker: string | null | undefined) {
  return quoteSpeaker?.trim() || sessionSpeaker?.trim() || "Pastor"
}

function hasSermonFlow(summary: SermonSummary) {
  const flow = summary.sermon_flow
  return (
    hasText(flow.opening) ||
    flow.main_points.length > 0 ||
    hasText(flow.conclusion) ||
    hasText(flow.response)
  )
}

function hasDevotional(summary: SermonSummary) {
  const devotional = summary.devotional
  return (
    hasText(devotional.scripture) ||
    hasText(devotional.observation) ||
    hasText(devotional.application) ||
    hasText(devotional.prayer) ||
    devotional.reflection_questions.length > 0
  )
}

export function SessionDetail({ sessionId, sessionTitle, initialTab, onBack }: SessionDetailProps) {
  const [tab, setTab] = useState<DetailTab>(initialTab ?? "summary")
  const [session, setSession] = useState<SermonSession | null>(null)
  // Bumped after a lazy audio merge so the <audio> element remounts and
  // reloads the freshly-written audio.mp3 (the path string is unchanged).
  const [audioNonce, setAudioNonce] = useState(0)
  const [detections, setDetections] = useState<SessionDetection[]>([])
  const [transcript, setTranscript] = useState<SessionTranscriptSegment[]>([])
  const [notes, setNotes] = useState<SessionNote[]>([])
  const [loading, setLoading] = useState(true)
  const [exportOpen, setExportOpen] = useState(false)
  const [summary, setSummary] = useState<SermonSummary | null>(null)
  const [summarizing, setSummarizing] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [summaryCopied, setSummaryCopied] = useState(false)
  const [showAllDetections, setShowAllDetections] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)
  // Transcript search + edit
  const [transcriptQuery, setTranscriptQuery] = useState("")
  const [transcriptEditMode, setTranscriptEditMode] = useState(false)
  const [editingSegmentId, setEditingSegmentId] = useState<number | null>(null)
  const [editingDraft, setEditingDraft] = useState("")
  // Series + tag editing
  const [seriesEditing, setSeriesEditing] = useState(false)
  const [seriesDraft, setSeriesDraft] = useState("")
  const [seriesOptions, setSeriesOptions] = useState<string[]>([])
  const seriesRef = useRef<HTMLDivElement>(null)

  // Load distinct series list for autocomplete suggestions.
  useEffect(() => {
    invoke<string[]>("list_session_series").then(setSeriesOptions).catch(() => setSeriesOptions([]))
  }, [])

  // Close series editor on outside click or Escape.
  useEffect(() => {
    if (!seriesEditing) return
    const onPointer = (e: MouseEvent) => {
      if (seriesRef.current && !seriesRef.current.contains(e.target as Node)) {
        setSeriesEditing(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSeriesEditing(false)
    }
    document.addEventListener("mousedown", onPointer)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onPointer)
      document.removeEventListener("keydown", onKey)
    }
  }, [seriesEditing])

  // Close export dropdown on outside click or Escape.
  useEffect(() => {
    if (!exportOpen) return
    const onPointer = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExportOpen(false)
    }
    document.addEventListener("mousedown", onPointer)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onPointer)
      document.removeEventListener("keydown", onKey)
    }
  }, [exportOpen])

  useEffect(() => {
    setLoading(true)
    Promise.all([
      invoke<SermonSession>("get_session", { id: sessionId }),
      invoke<SessionDetection[]>("get_session_detections", { sessionId }),
      invoke<SessionTranscriptSegment[]>("get_session_transcript", { sessionId }),
      invoke<SessionNote[]>("get_session_notes", { sessionId }),
    ]).then(([sess, dets, trans, n]) => {
      setSession(sess)
      setDetections(dets)
      setTranscript(trans)
      setNotes(n)
      setSummary(summaryFromJson(sess.summary))
      setLoading(false)

      // Lazily merge any leftover audio segments (e.g. the app reloaded or
      // crashed before End Session). Skip live sessions — their current
      // segment is still being written. Refresh audioPath after merging.
      if (sess.status !== "live") {
        void import("@/lib/finalize-recording").then(({ ensureSessionAudioMerged }) =>
          ensureSessionAudioMerged(sessionId).then((path) => {
            setSession((s) => (s ? { ...s, audioPath: path } : s))
            setAudioNonce((n) => n + 1)
          }),
        )
      }
    }).catch(() => setLoading(false))
  }, [sessionId])

  // ── Series ────────────────────────────────────────────────────────
  const openSeriesEditor = () => {
    setSeriesDraft(session?.seriesName ?? "")
    setSeriesEditing(true)
  }

  const saveSeries = async (value: string) => {
    const trimmed = value.trim()
    try {
      await invoke("update_session_series", {
        id: sessionId,
        series: trimmed.length > 0 ? trimmed : null,
      })
      setSession((s) => (s ? { ...s, seriesName: trimmed.length > 0 ? trimmed : null } : null))
      if (trimmed && !seriesOptions.includes(trimmed)) {
        setSeriesOptions((prev) => [...prev, trimmed].sort((a, b) => a.localeCompare(b)))
      }
    } catch (e) {
      console.error("[session] update series failed:", e)
    }
    setSeriesEditing(false)
  }

  // ── Tags ──────────────────────────────────────────────────────────
  const persistTags = async (next: string[]) => {
    try {
      await invoke("update_session_tags", { id: sessionId, tagsJson: JSON.stringify(next) })
      setSession((s) => (s ? { ...s, tags: next } : null))
    } catch (e) {
      console.error("[session] update tags failed:", e)
    }
  }

  const addTag = (raw: string) => {
    const tag = raw.trim()
    if (!tag) return
    const existing = session?.tags ?? []
    if (existing.includes(tag)) return
    persistTags([...existing, tag])
  }

  const removeTag = (tag: string) => {
    const next = (session?.tags ?? []).filter((t) => t !== tag)
    persistTags(next)
  }

  // ── Transcript inline edit ────────────────────────────────────────
  const startEditSegment = (seg: SessionTranscriptSegment) => {
    setEditingSegmentId(seg.id)
    setEditingDraft(seg.text)
  }

  const cancelEditSegment = () => {
    setEditingSegmentId(null)
    setEditingDraft("")
  }

  const saveEditSegment = async () => {
    if (editingSegmentId == null) return
    const id = editingSegmentId
    const next = editingDraft
    try {
      await invoke("update_transcript_segment", { segmentId: id, text: next })
      setTranscript((prev) => prev.map((s) => (s.id === id ? { ...s, text: next } : s)))
    } catch (e) {
      console.error("[session] update transcript segment failed:", e)
    }
    cancelEditSegment()
  }

  const deleteSegment = async (id: number) => {
    try {
      await invoke("delete_transcript_segment", { segmentId: id })
      setTranscript((prev) => prev.filter((s) => s.id !== id))
    } catch (e) {
      console.error("[session] delete transcript segment failed:", e)
    }
  }

  // ── Transcript search ─────────────────────────────────────────────
  const filteredTranscript = useMemo(() => {
    const q = transcriptQuery.trim().toLowerCase()
    if (!q) return transcript
    return transcript.filter((s) => s.text.toLowerCase().includes(q))
  }, [transcript, transcriptQuery])

  const handleEndSession = async () => {
    try {
      await invoke("end_session", { id: sessionId })
      setSession((s) => s ? { ...s, status: "completed" as const } : null)
      const { generateAndPersistSummary } = await import("@/lib/summarize")
      const result = await generateAndPersistSummary(sessionId)
      if (result) setSummary(result)
    } catch (e) {
      console.error("Failed to end session:", e)
    }
  }

  const handleCopyClipboard = () => {
    const text = buildSessionExportMarkdown(sessionTitle, detections, notes, transcript)
    navigator.clipboard.writeText(text)
    setExportOpen(false)
  }

  const handleDownloadMarkdown = async () => {
    const md = buildSessionExportMarkdown(sessionTitle, detections, notes, transcript)
    const slug = buildSessionExportSlug(sessionTitle)
    try {
      await saveTextExport(md, `${slug}.md`, { name: "Markdown", extensions: ["md"] })
      setExportOpen(false)
    } catch (e) {
      console.error("[session] markdown export failed:", e)
    }
  }

  const handleDownloadJson = async () => {
    const data = buildSessionExportJson(sessionTitle, sessionId, detections, notes, transcript)
    const slug = buildSessionExportSlug(sessionTitle)
    try {
      await saveTextExport(JSON.stringify(data, null, 2), `${slug}.json`, { name: "JSON", extensions: ["json"] })
      setExportOpen(false)
    } catch (e) {
      console.error("[session] JSON export failed:", e)
    }
  }

  const handlePrint = async () => {
    const bytes = buildSessionPdfBytes(sessionTitle, detections, notes, transcript)
    const slug = buildSessionExportSlug(sessionTitle)
    try {
      await saveBinaryExport(bytes, `${slug}.pdf`, { name: "PDF", extensions: ["pdf"] })
      setExportOpen(false)
    } catch (e) {
      console.error("[session] PDF export failed:", e)
    }
  }

  const handleSummarize = async () => {
    setExportOpen(false)
    setSummaryError(null)
    setSummarizing(true)
    setTab("summary")
    try {
      const text = transcript.map((s) => s.text).join(" ")
      if (!text.trim()) {
        throw new Error("No transcript to summarize.")
      }
      const presentedVerses = detections
        .filter((d) => d.wasPresented)
        .map((d) => d.verseRef)
      const result = await summarizeTranscript(text, presentedVerses)
      setSummary(result)
      await invoke("update_session_summary", {
        id: sessionId,
        summary: summaryToJson(result),
      }).catch((e) => console.warn("[summary] persist failed:", e))
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : JSON.stringify(err)
      setSummaryError(msg || "Summarization failed.")
      console.error("[summarize]", err)
    } finally {
      setSummarizing(false)
    }
  }

  const handleCopySummary = () => {
    if (summary) {
      const text = formatSummaryAsMarkdown(summary)
      navigator.clipboard.writeText(text)
      setSummaryCopied(true)
      setTimeout(() => setSummaryCopied(false), 2000)
    }
  }

  const presentedCount = detections.filter(d => d.wasPresented).length
  const uniqueBooks = new Set(detections.map(d => d.verseRef.split(" ")[0]))

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 flex-col gap-1 border-b border-border px-3 py-2">
       <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-xs" onClick={onBack}>
          <ArrowLeftIcon className="size-3.5" />
        </Button>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{sessionTitle}</span>
        {session?.status === "live" && (
          <Badge variant="outline" className="shrink-0 border-amber-500/30 bg-amber-500/10 text-[9px] text-amber-500">
            Still Live
          </Badge>
        )}

        {/* End session for orphaned live sessions */}
        {session?.status === "live" && (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 gap-1 text-destructive hover:text-destructive"
            onClick={handleEndSession}
          >
            <StopCircleIcon className="size-3" />
            End Session
          </Button>
        )}

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
              <div className="my-1 border-t border-border" />
              <button
                onClick={handleSummarize}
                disabled={summarizing || transcript.length === 0}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-muted/50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {summarizing ? (
                  <LoaderIcon className="size-3.5 animate-spin" />
                ) : (
                  <SparklesIcon className="size-3.5" />
                )}
                Summarize with AI
              </button>
            </div>
          )}
        </div>
       </div>

        {/* Series + tags row */}
        <div className="flex flex-wrap items-center gap-1.5 pl-7 pt-1">
          {/* Series chip */}
          <div className="relative" ref={seriesRef}>
            {seriesEditing ? (
              <div className="flex items-center gap-1">
                <Input
                  autoFocus
                  value={seriesDraft}
                  onChange={(e) => setSeriesDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveSeries(seriesDraft)
                    if (e.key === "Escape") setSeriesEditing(false)
                  }}
                  placeholder="Series name…"
                  className="h-6 w-44 text-[11px]"
                  list="series-suggestions"
                />
                <datalist id="series-suggestions">
                  {seriesOptions.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
                <Button size="icon-xs" variant="ghost" onClick={() => void saveSeries(seriesDraft)} title="Save">
                  <CheckIcon className="size-3" />
                </Button>
                <Button size="icon-xs" variant="ghost" onClick={() => setSeriesEditing(false)} title="Cancel">
                  <XIcon className="size-3" />
                </Button>
              </div>
            ) : session?.seriesName ? (
              <button
                onClick={openSeriesEditor}
                className="group inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary ring-1 ring-primary/20 hover:bg-primary/15"
                title="Edit series"
              >
                <TagIcon className="size-2.5" />
                {session.seriesName}
                <PencilIcon className="size-2 opacity-0 transition-opacity group-hover:opacity-60" />
              </button>
            ) : (
              <button
                onClick={openSeriesEditor}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:border-primary/40 hover:text-foreground"
              >
                <TagIcon className="size-2.5" />
                Add series
              </button>
            )}
          </div>

          {/* Tag chips */}
          {session?.tags?.map((tag) => (
            <span
              key={tag}
              className="group inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-foreground/80"
            >
              {tag}
              <button
                onClick={() => removeTag(tag)}
                className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                title="Remove tag"
              >
                <XIcon className="size-2.5" />
              </button>
            </span>
          ))}

          {/* Add tag */}
          <AddTagInline onAdd={addTag} />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex shrink-0 gap-1 border-b border-border px-3 py-1.5">
        {(["summary", "transcript", "detections", "stats"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors ${
              tab === t
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted/50"
            }`}
          >
            {t === "summary" && <SparklesIcon className="size-3" />}
            {t === "transcript" && <MicIcon className="size-3" />}
            {t === "detections" && <BookOpenIcon className="size-3" />}
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
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {showAllDetections
                  ? `${detections.length} detected`
                  : `${detections.filter((d) => d.wasPresented).length} shown on screen`}
              </span>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setShowAllDetections((v) => !v)}
                className="h-6 text-[10px]"
              >
                {showAllDetections ? "Shown only" : "Show all"}
              </Button>
            </div>
            {(() => {
              const filtered = showAllDetections
                ? detections
                : detections.filter((d) => d.wasPresented)
              if (filtered.length === 0) {
                return (
                  <p className="py-8 text-center text-xs text-muted-foreground">
                    {showAllDetections
                      ? "No detections recorded"
                      : "No verses went live in this session"}
                  </p>
                )
              }
              return filtered.map((d, i) => (
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
              ))
            })()}
          </div>
        )}

        {!loading && tab === "transcript" && (
          <div className="flex flex-col gap-2 p-3">
            {session?.audioPath && session?.startedAt && (
              <SessionAudioPlayer
                // Remount after a lazy merge so the player re-fetches the
                // freshly-concatenated audio.
                key={audioNonce}
                sessionId={sessionId}
                // SQLite `datetime('now')` emits `"YYYY-MM-DD HH:MM:SS"` in
                // UTC with no timezone marker. JS `new Date(...)` parses it as
                // *local* time, but transcript `timestampMs` is a true UTC
                // epoch ms, so subtraction would be off by the local TZ
                // offset for any non-UTC user. Force UTC parsing by inserting
                // `T` and appending `Z`.
                startedAtMs={new Date(`${session.startedAt.replace(" ", "T")}Z`).getTime()}
              />
            )}
            {transcript.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">No transcript recorded</p>
            ) : (
              <>
                <div className="sticky top-0 z-10 flex items-center gap-2 bg-background/95 pb-2 backdrop-blur-sm">
                  <div className="relative flex-1">
                    <SearchIcon className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={transcriptQuery}
                      onChange={(e) => setTranscriptQuery(e.target.value)}
                      placeholder="Search transcript…"
                      className="h-7 pl-7 text-xs"
                    />
                  </div>
                  <Button
                    size="sm"
                    variant={transcriptEditMode ? "default" : "outline"}
                    onClick={() => {
                      setTranscriptEditMode((v) => !v)
                      cancelEditSegment()
                    }}
                    className="h-7 gap-1 text-xs"
                  >
                    <PencilIcon className="size-3" />
                    {transcriptEditMode ? "Done" : "Edit"}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {transcriptQuery.trim().length > 0
                    ? `${filteredTranscript.length} match${filteredTranscript.length === 1 ? "" : "es"}`
                    : `${transcript.length} segments`}
                </p>
                <div className="flex flex-col gap-2">
                  {filteredTranscript.map((seg) => (
                    <TranscriptRow
                      key={seg.id}
                      segment={seg}
                      query={transcriptQuery}
                      editMode={transcriptEditMode}
                      editing={editingSegmentId === seg.id}
                      draft={editingDraft}
                      onStartEdit={() => startEditSegment(seg)}
                      onCancelEdit={cancelEditSegment}
                      onChangeDraft={setEditingDraft}
                      onSaveEdit={saveEditSegment}
                      onDelete={() => deleteSegment(seg.id)}
                    />
                  ))}
                  {filteredTranscript.length === 0 && (
                    <p className="py-4 text-center text-xs text-muted-foreground">No matching segments.</p>
                  )}
                </div>
              </>
            )}
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

        {!loading && tab === "summary" && (
          <div className="flex flex-col gap-3 p-3">
            {!summary && !summarizing && !summaryError && (
              <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
                <SparklesIcon className="size-6 text-muted-foreground/40" />
                <p className="text-xs text-muted-foreground">No summary yet.</p>
                <Button
                  size="sm"
                  onClick={handleSummarize}
                  disabled={transcript.length === 0}
                  className="gap-1.5"
                >
                  <SparklesIcon className="size-3.5" />
                  Generate summary
                </Button>
                {transcript.length === 0 && (
                  <p className="text-[10px] text-muted-foreground/70">Record some transcript first.</p>
                )}
              </div>
            )}

            {summarizing && (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 p-3">
                <LoaderIcon className="size-3.5 animate-spin text-primary" />
                <p className="text-xs text-muted-foreground">Summarizing transcript…</p>
              </div>
            )}

            {summaryError && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                <p className="text-xs text-red-500">{summaryError}</p>
                <Button size="sm" variant="ghost" onClick={handleSummarize} className="mt-2 gap-1.5">
                  <RefreshCwIcon className="size-3" />
                  Retry
                </Button>
              </div>
            )}

            {summary && !summarizing && (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <SparklesIcon className="size-3.5 text-primary" />
                    <span className="text-[10px] font-medium uppercase tracking-wider text-primary">AI Summary</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={handleCopySummary}
                      title="Copy summary as markdown"
                    >
                      {summaryCopied ? <CheckIcon className="size-3 text-primary" /> : <CopyIcon className="size-3" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={handleSummarize}
                      title="Regenerate"
                      disabled={summarizing}
                    >
                      <RefreshCwIcon className="size-3" />
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
                  {/* Left column — narrative */}
                  <div className="flex flex-col gap-3">
                    {(hasText(summary.title) || hasText(summary.big_idea)) && (
                      <SummaryCard title="Big Idea" tone="primary">
                        {hasText(summary.title) && (
                          <p className="text-sm font-semibold text-foreground">{summary.title}</p>
                        )}
                        {hasText(summary.big_idea) && (
                          <p className="text-xs leading-relaxed text-foreground/85">{summary.big_idea}</p>
                        )}
                      </SummaryCard>
                    )}

                    {summary.key_verses.length > 0 && (
                      <SummaryCard title="Key Verses">
                        <ul className="flex flex-col gap-2">
                          {summary.key_verses.map((v, i) => (
                            <li
                              key={i}
                              className="rounded-md border border-primary/15 bg-primary/5 px-2.5 py-2"
                            >
                              <p className="text-xs font-semibold text-primary">{v.reference}</p>
                              {hasText(v.reason) && (
                                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{v.reason}</p>
                              )}
                            </li>
                          ))}
                        </ul>
                      </SummaryCard>
                    )}

                    {hasSermonFlow(summary) && (
                      <SummaryCard title="Sermon Flow">
                        <div className="flex flex-col gap-3">
                          {hasText(summary.sermon_flow.opening) && (
                            <SummaryField label="Opening" value={summary.sermon_flow.opening} />
                          )}

                          {summary.sermon_flow.main_points.length > 0 && (
                            <div className="flex flex-col gap-2">
                              {summary.sermon_flow.main_points.map((point, i) => (
                                <div key={i} className="rounded-md border border-border bg-card/50 p-3">
                                  <div className="flex gap-2">
                                    <span className="shrink-0 text-[10px] font-semibold text-muted-foreground/70">
                                      {i + 1}.
                                    </span>
                                    <div className="min-w-0 flex-1">
                                      <p className="text-xs font-semibold leading-relaxed text-foreground">
                                        {point.point}
                                      </p>
                                      {hasText(point.explanation) && (
                                        <p className="mt-1 text-[11px] leading-relaxed text-foreground/80">
                                          {point.explanation}
                                        </p>
                                      )}
                                      {point.scripture_refs.length > 0 && (
                                        <div className="mt-2 flex flex-wrap gap-1">
                                          {point.scripture_refs.map((ref, refIndex) => (
                                            <span
                                              key={`${ref}-${refIndex}`}
                                              className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
                                            >
                                              {ref}
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                      {hasText(point.illustration_or_moment) && (
                                        <SummaryField
                                          label="Moment"
                                          value={point.illustration_or_moment}
                                          compact
                                        />
                                      )}
                                      {hasText(point.application) && (
                                        <SummaryField label="Application" value={point.application} compact />
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {hasText(summary.sermon_flow.conclusion) && (
                            <SummaryField label="Conclusion" value={summary.sermon_flow.conclusion} />
                          )}
                          {hasText(summary.sermon_flow.response) && (
                            <SummaryField label="Response" value={summary.sermon_flow.response} />
                          )}
                        </div>
                      </SummaryCard>
                    )}

                    {summary.takeaways.length > 0 && (
                      <SummaryCard title="Takeaways" tone="accent">
                        <ul className="flex flex-col gap-1.5">
                          {summary.takeaways.map((t, i) => (
                            <li key={i} className="flex gap-2 text-xs leading-relaxed text-foreground/85">
                              <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-primary" />
                              <span>{t}</span>
                            </li>
                          ))}
                        </ul>
                      </SummaryCard>
                    )}
                  </div>

                  {/* Right column — devotional + quotes */}
                  <aside className="flex flex-col gap-3 lg:sticky lg:top-2 lg:self-start">
                    {hasDevotional(summary) && (
                      <SummaryCard title="Devotional Follow-up">
                        <div className="flex flex-col gap-2.5">
                          {hasText(summary.devotional.scripture) && (
                            <SummaryField label="Scripture" value={summary.devotional.scripture} />
                          )}
                          {hasText(summary.devotional.observation) && (
                            <SummaryField label="Observation" value={summary.devotional.observation} />
                          )}
                          {hasText(summary.devotional.application) && (
                            <SummaryField label="Application" value={summary.devotional.application} />
                          )}
                          {hasText(summary.devotional.prayer) && (
                            <SummaryField label="Prayer" value={summary.devotional.prayer} />
                          )}
                          {summary.devotional.reflection_questions.length > 0 && (
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                Reflection Questions
                              </p>
                              <ul className="mt-1.5 flex flex-col gap-1.5">
                                {summary.devotional.reflection_questions.map((question, i) => (
                                  <li key={i} className="flex gap-2 text-xs leading-relaxed text-foreground/85">
                                    <span className="shrink-0 text-muted-foreground/60">{i + 1}.</span>
                                    <span>{question}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </SummaryCard>
                    )}

                    {summary.quotes && summary.quotes.length > 0 ? (
                      <SummaryCard title="Quotes" tone="primary">
                        <ul className="flex flex-col gap-2">
                          {summary.quotes.map((q, i) => (
                            <li
                              key={i}
                              className="group flex flex-col gap-1.5 rounded-md border border-border bg-card/60 p-3"
                            >
                              <p className="font-serif text-sm italic leading-snug text-foreground">
                                “{q.text}”
                              </p>
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[10px] text-muted-foreground">
                                  {quoteSpeaker(q.speaker, session?.speaker)}
                                </span>
                                <button
                                  onClick={() => {
                                    const line = `“${q.text}” — ${quoteSpeaker(q.speaker, session?.speaker)}`
                                    navigator.clipboard.writeText(line)
                                  }}
                                  className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                                >
                                  Copy
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </SummaryCard>
                    ) : (
                      <SummaryCard title="Quotes">
                        <p className="text-[11px] text-muted-foreground">No notable quotes pulled from this sermon.</p>
                      </SummaryCard>
                    )}
                  </aside>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryCard({
  title,
  tone = "default",
  children,
}: {
  title: string
  tone?: "default" | "primary" | "accent"
  children: React.ReactNode
}) {
  const border =
    tone === "primary"
      ? "border-primary/30 bg-primary/5"
      : tone === "accent"
        ? "border-amber-500/25 bg-amber-500/5"
        : "border-border bg-muted/20"
  return (
    <div className={`flex flex-col gap-2 rounded-lg border p-3 ${border}`}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </span>
      {children}
    </div>
  )
}

function SummaryField({
  label,
  value,
  compact = false,
}: {
  label: string
  value: string
  compact?: boolean
}) {
  return (
    <div className={compact ? "mt-2" : ""}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-foreground/85">{value}</p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Highlighted transcript line + inline edit                                 */
/* -------------------------------------------------------------------------- */

function highlightMatches(text: string, query: string): React.ReactNode {
  const q = query.trim()
  if (q.length < 2) return text
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig")
  const parts = text.split(re)
  return parts.map((p, i) =>
    re.test(p) ? (
      <mark key={i} className="rounded-[2px] bg-amber-300/30 px-0.5 text-foreground">{p}</mark>
    ) : (
      <span key={i}>{p}</span>
    ),
  )
}

interface TranscriptRowProps {
  segment: SessionTranscriptSegment
  query: string
  editMode: boolean
  editing: boolean
  draft: string
  onStartEdit: () => void
  onCancelEdit: () => void
  onChangeDraft: (v: string) => void
  onSaveEdit: () => void
  onDelete: () => void
}

function TranscriptRow({
  segment,
  query,
  editMode,
  editing,
  draft,
  onStartEdit,
  onCancelEdit,
  onChangeDraft,
  onSaveEdit,
  onDelete,
}: TranscriptRowProps) {
  if (editing) {
    return (
      <div className="flex flex-col gap-1 rounded-md border border-primary/30 bg-primary/5 p-2">
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => onChangeDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              onSaveEdit()
            } else if (e.key === "Escape") {
              onCancelEdit()
            }
          }}
          className="min-h-[60px] w-full resize-y rounded bg-background p-2 text-sm leading-relaxed"
        />
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={onCancelEdit} className="h-6 text-xs">
            Cancel
          </Button>
          <Button size="sm" onClick={onSaveEdit} className="h-6 text-xs">
            Save
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="group flex items-start gap-1">
      <button
        type="button"
        onClick={() => emitAudioSeek(segment.timestampMs)}
        className="mt-0.5 shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-primary/10 hover:text-primary group-hover:opacity-100"
        title="Play from here"
      >
        <PlayIcon className="size-3" />
      </button>
      <p
        onClick={editMode ? onStartEdit : undefined}
        className={`flex-1 text-sm leading-relaxed text-foreground/80 ${editMode ? "cursor-text rounded px-1 -mx-1 hover:bg-muted/40" : ""}`}
      >
        {highlightMatches(segment.text, query)}
      </p>
      {editMode && (
        <button
          onClick={onDelete}
          className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
          title="Delete segment"
        >
          <Trash2Icon className="size-3" />
        </button>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Inline tag input                                                          */
/* -------------------------------------------------------------------------- */

function AddTagInline({ onAdd }: { onAdd: (tag: string) => void }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState("")

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:border-primary/40 hover:text-foreground"
      >
        + Tag
      </button>
    )
  }

  const commit = () => {
    if (value.trim()) onAdd(value)
    setValue("")
    setOpen(false)
  }

  return (
    <Input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit()
        if (e.key === "Escape") {
          setValue("")
          setOpen(false)
        }
      }}
      placeholder="tag…"
      className="h-6 w-24 text-[11px]"
    />
  )
}
