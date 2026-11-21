import { CreateSessionForm } from "./sessions-panel/(components)/create-session-form"
import { useState, useEffect, useCallback } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Trash2Icon } from "lucide-react"
import { useSession } from "@/hooks/use-session"
import { useSessionStore } from "@/stores"
import type { PendingSessionTab } from "@/stores/session-store"
import type { SermonSession } from "@/types/session"
import { SessionDetail } from "./session-detail"


function SessionRow({
  session,
  isActive,
  onClick,
  onContextMenu,
  onTitleChange,
  onDelete,
  deleteDisabled,
}: {
  session: SermonSession
  isActive: boolean
  onClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onTitleChange: (newTitle: string) => void
  deleteDisabled: boolean
  onDelete: () => void
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
    <div
      role="button"
      tabIndex={0}
      className={`group flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/50 ${isActive ? "bg-muted" : ""}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => {
        if (e.key === "Enter") onClick()
      }}
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
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          if (confirm(`Delete "${session.title}"? This cannot be undone.`)) {
            onDelete()
          }
        }}
        disabled={deleteDisabled}
        title={deleteDisabled ? "End this session before deleting it" : "Delete session"}
        className="shrink-0 rounded-md p-1 text-muted-foreground/50 opacity-0 transition-all hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Trash2Icon className="size-3.5" />
      </button>
    </div>
  )
}

export function SessionsPanel() {
  const { listSessions, renameSession } = useSession()
  const activeSession = useSessionStore((s) => s.activeSession)
  const pendingView = useSessionStore((s) => s.sessionsView)
  const clearPendingView = useSessionStore((s) => s.clearSessionInMode)
  const [sessions, setSessions] = useState<SermonSession[]>([])
  const [localView, setLocalView] = useState<{ id: number; title: string; tab?: PendingSessionTab } | null>(null)
  const viewingSession = pendingView ?? localView
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; sessionId: number } | null>(null)

  const loadSessions = useCallback(() => {
    listSessions().then((s) => {
      // Sort by createdAt descending — newest first
      const sorted = [...s].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      setSessions(sorted)
    }).catch(() => {})
  }, [listSessions])

  useEffect(() => {
    loadSessions()
  }, [loadSessions, activeSession?.title])

  if (viewingSession) {
    return (
      <SessionDetail
        sessionId={viewingSession.id}
        sessionTitle={viewingSession.title}
        initialTab={viewingSession.tab}
        onBack={() => {
          setLocalView(null)
          clearPendingView()
        }}
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
              deleteDisabled={activeSession?.id === session.id && activeSession.status === "live"}
              onClick={() => {
                setLocalView({ id: session.id, title: session.title })
              }}
              onTitleChange={async (newTitle) => {
                try {
                  await renameSession(session.id, newTitle)
                  loadSessions()
                } catch (error) {
                  console.warn("[sessions] Failed to update title", error)
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setContextMenu({ x: e.clientX, y: e.clientY, sessionId: session.id })
              }}
              onDelete={async () => {
                try {
                  await invoke("delete_session", { id: session.id })
                  if (useSessionStore.getState().activeSession?.id === session.id) {
                    useSessionStore.getState().setActiveSession(null)
                  }
                  loadSessions()
                } catch (e) {
                  console.error("Failed to delete session:", e)
                }
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
                const session = sessions.find(s => s.id === contextMenu.sessionId)
                setLocalView({ id: contextMenu.sessionId, title: session?.title ?? "" })
                setContextMenu(null)
              }}
            >
              View Details
            </button>
            <button
              disabled={activeSession?.id === contextMenu.sessionId && activeSession.status === "live"}
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
