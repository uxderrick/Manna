import { resolveChurchAsset } from "@/lib/church-assets"
import { CreateSessionForm } from "./sessions-landing/(components)/create-session-form"
import { useEffect, useMemo, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import {
  Trash2Icon,
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ArrowLeftIcon,
  SparklesIcon,
  ClockIcon,
  BookOpenIcon,
  TvIcon,
  SettingsIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useSession } from "@/hooks/use-session"
import { restoreLiveSession } from "@/lib/restore-live-session"
import { useSessionStore, useSettingsStore } from "@/stores"
import { resolveBrandAsset, resolveChurchName } from "@/lib/brand"
import { summaryFromJson } from "@/lib/summarize"
import type { SermonSession } from "@/types/session"
import { SessionDetail } from "@/components/panels/session-detail"

interface SessionRowStats {
  durationMinutes: number | null
  detectionCount: number
  presentedCount: number
  hasSummary: boolean
  topVerse: string | null
}

export function SessionsLanding() {
  const { listSessions } = useSession()
  const sessionsMode = useSessionStore((s) => s.sessionsMode)
  const sessionsView = useSessionStore((s) => s.sessionsView)
  const openSessionInMode = useSessionStore((s) => s.openSessionInMode)
  const clearSessionInMode = useSessionStore((s) => s.clearSessionInMode)
  const closeSessions = useSessionStore((s) => s.closeSessions)
  const workspaceUnlocked = useSessionStore((s) => s.workspaceUnlocked)
  const activeTitle = useSessionStore((s) => s.activeSession?.title)
  const protectedSessionId = useSessionStore((s) => s.activeSession?.status === "live" ? s.activeSession.id : null)
  const brand = useSettingsStore((s) => s.brand)

  const [sessions, setSessions] = useState<SermonSession[]>([])
  const [stats, setStats] = useState<Record<number, SessionRowStats>>({})
  const [page, setPage] = useState(0)
  const [deleteTarget, setDeleteTarget] = useState<SermonSession | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [seriesFilter, setSeriesFilter] = useState<string | null>(null)

  const PAGE_SIZE = 5

  const seriesPills = useMemo(() => {
    const set = new Set<string>()
    for (const s of sessions) if (s.seriesName) set.add(s.seriesName)
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [sessions])

  const visibleSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return sessions.filter((s) => {
      if (seriesFilter && s.seriesName !== seriesFilter) return false
      if (!q) return true
      const hay = [
        s.title,
        s.speaker ?? "",
        s.seriesName ?? "",
        s.summary ?? "",
      ]
        .join(" ")
        .toLowerCase()
      return hay.includes(q)
    })
  }, [sessions, searchQuery, seriesFilter])

  const pageCount = Math.max(1, Math.ceil(visibleSessions.length / PAGE_SIZE))
  const pagedSessions = useMemo(
    () => visibleSessions.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [visibleSessions, page]
  )

  useEffect(() => {
    setPage(0)
  }, [searchQuery, seriesFilter])

  const load = () => {
    listSessions()
      .then((s) =>
        setSessions(
          [...s].sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          )
        )
      )
      .catch(() => setSessions([]))
  }

  useEffect(load, [listSessions, activeTitle])

  useEffect(() => {
    if (page > 0 && page >= pageCount) setPage(pageCount - 1)
  }, [page, pageCount])

  // Lazy-load per-row stats only for the rows on the current page so we don't
  // hammer the DB for a thousand-session history.
  useEffect(() => {
    let cancelled = false
    void Promise.all(
      pagedSessions
        .filter((s) => !(s.id in stats))
        .map(async (s) => {
          const stat = await fetchSessionStats(s)
          return [s.id, stat] as const
        })
    ).then((entries) => {
      if (cancelled || entries.length === 0) return
      setStats((prev) => {
        const next = { ...prev }
        for (const [id, stat] of entries) next[id] = stat
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [pagedSessions, stats])

  const handleOpenPast = async (session: SermonSession) => {
    // Live sessions aren't finished — drop user into the workspace so they
    // can keep operating, not into the review detail.
    if (session.status === "live") {
      try {
        if (await restoreLiveSession(session)) closeSessions()
      } catch (error) {
        console.error("[landing] resume session failed:", error)
      }
      return
    }
    openSessionInMode({ id: session.id, title: session.title, tab: "summary" })
  }

  const handleDelete = (session: SermonSession, e: React.MouseEvent) => {
    e.stopPropagation()
    setDeleteTarget(session)
  }

  const confirmDelete = async () => {
    if (!deleteTarget || deleteTarget.id === protectedSessionId) return
    const id = deleteTarget.id
    setDeleting(true)
    try {
      await invoke("delete_session", { id })
      setStats((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      load()
      setDeleteTarget(null)
    } catch (err) {
      console.error("[landing] delete failed:", err)
    } finally {
      setDeleting(false)
    }
  }

  // Detail view in Sessions Mode — SessionDetail already renders its own
  // header with back + export, so we just let it fill the screen.
  if (sessionsView) {
    return (
      <div className="fixed inset-0 z-40 flex flex-col bg-background">
        <SessionDetail
          sessionId={sessionsView.id}
          sessionTitle={sessionsView.title}
          initialTab={sessionsView.tab}
          onBack={() => clearSessionInMode()}
        />
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-background">
      {/* Subtle ambient pattern — inverted logo tiled, denser, radially faded. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 opacity-[0.06] [filter:invert(1)] dark:opacity-[0.1] dark:[filter:invert(0)]"
        style={{
          backgroundImage: "url(/manna-logo.png)",
          backgroundRepeat: "repeat",
          backgroundSize: "80px 80px",
          maskImage:
            "radial-gradient(closest-side at 50% 38%, black 0%, black 45%, transparent 95%)",
          WebkitMaskImage:
            "radial-gradient(closest-side at 50% 38%, black 0%, black 45%, transparent 95%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            "radial-gradient(55% 55% at 50% 32%, rgba(120, 180, 140, 0.05), transparent 75%)",
        }}
      />
      {workspaceUnlocked && sessionsMode && (
        <div className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-card/95 px-4 py-2 backdrop-blur">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => closeSessions()}
            className="gap-1.5"
          >
            <ArrowLeftIcon className="size-3.5" />
            Back to workspace
          </Button>
          <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Sessions
          </span>
          <div className="w-[120px]" />
        </div>
      )}

      {/* Top-right Settings shortcut — landing has no toolbar otherwise. */}
      <div className="absolute top-4 right-4 z-20">
        <Button
          variant="ghost"
          size="icon-sm"
          title="Settings"
          onClick={() => {
            void import("@/lib/settings-dialog").then(({ openSettings }) =>
              openSettings()
            )
          }}
        >
          <SettingsIcon className="size-4" />
        </Button>
      </div>

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-12">
        <header className="flex flex-col items-center gap-3 text-center">
          <div className="rounded-full bg-card p-2 ring-2 ring-primary/30 ring-offset-4 ring-offset-background">
            <img
              src={resolveChurchAsset(resolveBrandAsset("logo", brand.logoPath))}
              alt={resolveChurchName(brand.churchName)}
              className="size-16 rounded-full"
            />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Welcome to {resolveChurchName(brand.churchName)}
            {brand.campusName && (
              <span className="mt-2 block text-sm font-normal text-muted-foreground">
                {brand.campusName}
              </span>
            )}
          </h1>
          <p className="max-w-md text-sm text-muted-foreground">
            Start a new service to begin live detection, or open a past session
            to review its summary.
          </p>
        </header>

        <CreateSessionForm />

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-wider text-muted-foreground uppercase">
              Past sessions
            </h2>
            <span className="text-xs text-muted-foreground/70">
              {searchQuery.trim() || seriesFilter
                ? `${visibleSessions.length} of ${sessions.length}`
                : `${sessions.length} total`}
            </span>
          </div>

          {sessions.length > 0 && (
            <div className="flex flex-col gap-2">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by title, speaker, series…"
                className="h-8 text-xs"
              />
              {seriesPills.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  <button
                    onClick={() => setSeriesFilter(null)}
                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
                      seriesFilter === null
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/60"
                    }`}
                  >
                    All
                  </button>
                  {seriesPills.map((s) => (
                    <button
                      key={s}
                      onClick={() =>
                        setSeriesFilter(s === seriesFilter ? null : s)
                      }
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
                        seriesFilter === s
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/60"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {sessions.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card/40 p-8 text-center">
              <CalendarIcon className="size-6 text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground">
                No previous sessions yet. Your first one will land here.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {pagedSessions.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  stats={stats[session.id]}
                  onClick={() => handleOpenPast(session)}
                  deleteDisabled={session.id === protectedSessionId}
                  onDelete={(e) => handleDelete(session, e)}
                />
              ))}
            </ul>
          )}

          {visibleSessions.length > PAGE_SIZE && (
            <div className="mt-2 flex items-center justify-between rounded-lg border border-border/60 bg-card/40 px-3 py-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="gap-1"
              >
                <ChevronLeftIcon className="size-3.5" />
                Prev
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums">
                Page {page + 1} of {pageCount}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={page >= pageCount - 1}
                className="gap-1"
              >
                Next
                <ChevronRightIcon className="size-3.5" />
              </Button>
            </div>
          )}
        </section>
      </div>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete session?</DialogTitle>
            <DialogDescription>
              {deleteTarget ? (
                <>
                  This will permanently delete{" "}
                  <span className="font-medium text-foreground">
                    {deleteTarget.title}
                  </span>{" "}
                  along with its transcript, detections, and summary. This
                  cannot be undone.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting}
              className="gap-1.5"
            >
              <Trash2Icon className="size-3.5" />
              {deleting ? "Deleting…" : "Delete session"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SessionCard({
  session,
  stats,
  onClick,
  onDelete,
  deleteDisabled,
}: {
  session: SermonSession
  stats: SessionRowStats | undefined
  onClick: () => void
  deleteDisabled: boolean
  onDelete: (e: React.MouseEvent) => void
}) {
  return (
    <li
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") onClick()
      }}
      className="group flex cursor-pointer flex-col gap-2 rounded-lg border border-border/60 bg-card px-4 py-3 transition-colors hover:border-primary/40 hover:bg-card/80"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {session.title}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {session.date}
            {session.speaker ? ` · ${session.speaker}` : ""}
            {session.seriesName ? ` · ${session.seriesName}` : ""}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${
            session.status === "live"
              ? "bg-destructive/15 text-destructive"
              : session.status === "completed"
                ? "bg-primary/15 text-primary"
                : "bg-muted text-muted-foreground"
          }`}
        >
          {session.status}
        </span>
        <button
          type="button"
          onClick={onDelete}
          disabled={deleteDisabled}
          title={deleteDisabled ? "End this session before deleting it" : "Delete session"}
          className="shrink-0 rounded-md p-1.5 text-muted-foreground/50 opacity-0 transition-all group-hover:opacity-100 hover:bg-destructive/15 hover:text-destructive"
        >
          <Trash2Icon className="size-3.5" />
        </button>
      </div>

      {stats && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {stats.durationMinutes != null && (
            <Chip icon={<ClockIcon className="size-3" />}>
              {formatDuration(stats.durationMinutes)}
            </Chip>
          )}
          {stats.detectionCount > 0 && (
            <Chip icon={<BookOpenIcon className="size-3" />}>
              {stats.detectionCount} detected
            </Chip>
          )}
          {stats.presentedCount > 0 && (
            <Chip icon={<TvIcon className="size-3" />}>
              {stats.presentedCount} shown
            </Chip>
          )}
          {stats.hasSummary && (
            <Chip
              icon={<SparklesIcon className="size-3 text-primary" />}
              highlight
            >
              {stats.topVerse ? `Summary · ${stats.topVerse}` : "Summary ready"}
            </Chip>
          )}
        </div>
      )}
    </li>
  )
}

function Chip({
  children,
  icon,
  highlight = false,
}: {
  children: React.ReactNode
  icon?: React.ReactNode
  highlight?: boolean
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
        highlight
          ? "bg-primary/10 text-primary"
          : "bg-muted/40 text-muted-foreground"
      }`}
    >
      {icon}
      {children}
    </span>
  )
}

function formatDuration(min: number): string {
  if (min < 1) return "<1m"
  if (min < 60) return `${Math.round(min)}m`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

async function fetchSessionStats(
  session: SermonSession
): Promise<SessionRowStats> {
  try {
    type DetRow = { wasPresented: boolean }
    const detections = await invoke<DetRow[]>("get_session_detections", {
      sessionId: session.id,
    })
    const presentedCount = detections.filter((d) => d.wasPresented).length
    const summary = summaryFromJson(session.summary)
    const topVerse = summary?.key_verses?.[0]?.reference ?? null
    let durationMinutes: number | null = null
    if (session.startedAt && session.endedAt) {
      const start = new Date(session.startedAt).getTime()
      const end = new Date(session.endedAt).getTime()
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        durationMinutes = (end - start) / 60000
      }
    }
    return {
      durationMinutes,
      detectionCount: detections.length,
      presentedCount,
      hasSummary: summary != null,
      topVerse,
    }
  } catch {
    return {
      durationMinutes: null,
      detectionCount: 0,
      presentedCount: 0,
      hasSummary: false,
      topVerse: null,
    }
  }
}
