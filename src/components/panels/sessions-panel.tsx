import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useSession } from "@/hooks/use-session"
import { useSessionStore } from "@/stores"
import type { SermonSession, CreateSessionRequest } from "@/types/session"
import { SessionDetail } from "./session-detail"

function CreateSessionForm({ onCreated }: { onCreated: () => void }) {
  const { createSession, startSession } = useSession()
  const [title, setTitle] = useState(() => {
    const now = new Date()
    const date = now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" })
    const time = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
    return `${date} — ${time}`
  })
  const [speaker, setSpeaker] = useState("")
  const [seriesName, setSeriesName] = useState("")
  const [isCreating, setIsCreating] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setIsCreating(true)
    try {
      const request: CreateSessionRequest = {
        title: title.trim(),
        speaker: speaker.trim() || undefined,
        date: new Date().toISOString().split("T")[0],
        seriesName: seriesName.trim() || undefined,
      }
      const session = await createSession(request)
      const started = await startSession(session.id)
      useSessionStore.getState().setActiveSession(started)
      const next = new Date()
      const nextDate = next.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" })
      const nextTime = next.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
      setTitle(`${nextDate} — ${nextTime}`)
      setSpeaker("")
      setSeriesName("")
      onCreated()
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 border-b border-border p-3">
      <p className="text-xs font-medium text-muted-foreground">New Session</p>
      <input
        className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        placeholder="Session title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
      />
      <input
        className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        placeholder="Speaker"
        value={speaker}
        onChange={(e) => setSpeaker(e.target.value)}
      />
      <input
        className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        placeholder="Series name"
        value={seriesName}
        onChange={(e) => setSeriesName(e.target.value)}
      />
      <button
        type="submit"
        disabled={!title.trim() || isCreating}
        className="w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {isCreating ? "Creating…" : "Create & Start Session"}
      </button>
    </form>
  )
}

function SessionRow({
  session,
  isActive,
  onClick,
  onContextMenu,
  onTitleChange,
}: {
  session: SermonSession
  isActive: boolean
  onClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onTitleChange: (newTitle: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(session.title)

  const statusColors: Record<string, string> = {
    planned: "bg-muted text-muted-foreground",
    live: "bg-live-pulse/20 text-live-pulse",
    completed: "bg-primary/10 text-primary",
  }

  const handleSaveTitle = () => {
    const trimmed = editTitle.trim()
    if (trimmed && trimmed !== session.title) {
      onTitleChange(trimmed)
    } else {
      setEditTitle(session.title)
    }
    setEditing(false)
  }

  return (
    <button
      className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/50 ${isActive ? "bg-muted" : ""}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={handleSaveTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSaveTitle()
              if (e.key === "Escape") { setEditTitle(session.title); setEditing(false) }
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full rounded border border-primary bg-transparent px-1 py-0.5 text-sm font-medium outline-none focus:ring-1 focus:ring-primary"
          />
        ) : (
          <p
            className="truncate font-medium"
            onDoubleClick={(e) => { e.stopPropagation(); setEditing(true) }}
          >
            {session.title}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {session.date}
          {session.speaker && ` · ${session.speaker}`}
        </p>
      </div>
      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${statusColors[session.status] ?? ""}`}
      >
        {session.status}
      </span>
    </button>
  )
}

export function SessionsPanel() {
  const { listSessions } = useSession()
  const activeSession = useSessionStore((s) => s.activeSession)
  const [sessions, setSessions] = useState<SermonSession[]>([])
  const [viewingSessionId, setViewingSessionId] = useState<number | null>(null)
  const [viewingSessionTitle, setViewingSessionTitle] = useState("")
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; sessionId: number } | null>(null)

  function loadSessions() {
    listSessions().then((s) => {
      // Sort by createdAt descending — newest first
      const sorted = [...s].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      setSessions(sorted)
    }).catch(() => {})
  }

  useEffect(() => {
    loadSessions()
  }, [])

  if (viewingSessionId) {
    return (
      <SessionDetail
        sessionId={viewingSessionId}
        sessionTitle={viewingSessionTitle}
        onBack={() => setViewingSessionId(null)}
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      <CreateSessionForm onCreated={loadSessions} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {sessions.length === 0 ? (
          <p className="p-4 text-center text-xs text-muted-foreground">
            No sessions yet
          </p>
        ) : (
          sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              isActive={activeSession?.id === session.id}
              onClick={() => {
                setViewingSessionId(session.id)
                setViewingSessionTitle(session.title)
              }}
              onTitleChange={async (newTitle) => {
                try {
                  await invoke("update_session_title", { id: session.id, title: newTitle })
                  loadSessions()
                } catch {}
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setContextMenu({ x: e.clientX, y: e.clientY, sessionId: session.id })
              }}
            />
          ))
        )}
      </div>
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-50 min-w-[140px] rounded-lg border border-border bg-popover p-1 shadow-lg"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-popover-foreground hover:bg-accent"
              onClick={() => {
                setViewingSessionId(contextMenu.sessionId)
                const session = sessions.find(s => s.id === contextMenu.sessionId)
                setViewingSessionTitle(session?.title ?? "")
                setContextMenu(null)
              }}
            >
              View Details
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10"
              onClick={async () => {
                try {
                  await invoke("delete_session", { id: contextMenu.sessionId })
                  // If deleting the active session, clear it
                  if (useSessionStore.getState().activeSession?.id === contextMenu.sessionId) {
                    useSessionStore.getState().setActiveSession(null)
                  }
                  loadSessions()
                } catch (e) {
                  console.error("Failed to delete session:", e)
                }
                setContextMenu(null)
              }}
            >
              Delete Session
            </button>
          </div>
        </>
      )}
    </div>
  )
}
