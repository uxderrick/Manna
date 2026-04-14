import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { PanelHeader } from "@/components/ui/panel-header"
import { Badge } from "@/components/ui/badge"
import { BarChart3Icon, BookOpenIcon, ClockIcon, HashIcon } from "lucide-react"
import type { SermonSession } from "@/types/session"

interface AggregateStats {
  totalSessions: number
  totalDetections: number
  totalHours: number
  topBook: string
}

interface VerseFrequency {
  verseRef: string
  count: number
}

export function AnalyticsPanel() {
  const [stats, setStats] = useState<AggregateStats | null>(null)
  const [verseFreq, setVerseFreq] = useState<VerseFrequency[]>([])
  const [recentSessions, setRecentSessions] = useState<SermonSession[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = () => {
    setLoading(true)
    Promise.all([
      invoke<AggregateStats>("get_aggregate_stats"),
      invoke<VerseFrequency[]>("get_verse_frequency", { limit: 10 }),
      invoke<SermonSession[]>("get_recent_sessions", { limit: 10 }),
    ]).then(([s, vf, rs]) => {
      setStats(s)
      setVerseFreq(vf)
      setRecentSessions(rs)
      setLoading(false)
    }).catch(() => setLoading(false))
  }

  useEffect(() => { loadData() }, [])

  const maxCount = verseFreq.length > 0 ? verseFreq[0].count : 1

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-card">
        <p className="text-xs text-muted-foreground">Loading analytics...</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-card">
      <PanelHeader title="Analytics">
        <button onClick={loadData} className="text-[10px] text-muted-foreground hover:text-foreground">
          Refresh
        </button>
      </PanelHeader>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {/* Stat Cards */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-surface-elevated p-3 ring-1 ring-border">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <HashIcon className="size-3" />
              <span className="text-[10px] font-medium">Sessions</span>
            </div>
            <p className="mt-1 text-xl font-bold">{stats?.totalSessions ?? 0}</p>
          </div>
          <div className="rounded-xl bg-surface-elevated p-3 ring-1 ring-border">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <BookOpenIcon className="size-3" />
              <span className="text-[10px] font-medium">Verses Detected</span>
            </div>
            <p className="mt-1 text-xl font-bold">{stats?.totalDetections ?? 0}</p>
          </div>
          <div className="rounded-xl bg-surface-elevated p-3 ring-1 ring-border">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <ClockIcon className="size-3" />
              <span className="text-[10px] font-medium">Hours</span>
            </div>
            <p className="mt-1 text-xl font-bold">{(stats?.totalHours ?? 0).toFixed(1)}</p>
          </div>
          <div className="rounded-xl bg-surface-elevated p-3 ring-1 ring-border">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <BarChart3Icon className="size-3" />
              <span className="text-[10px] font-medium">Top Book</span>
            </div>
            <p className="mt-1 truncate text-sm font-bold">{stats?.topBook ?? "—"}</p>
          </div>
        </div>

        {/* Verse Frequency */}
        {verseFreq.length > 0 && (
          <div className="mt-4">
            <h3 className="text-xs font-bold text-foreground">Most Preached Verses</h3>
            <div className="mt-2 flex flex-col gap-1.5">
              {verseFreq.map((vf, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 truncate text-[11px] font-medium text-primary">{vf.verseRef}</span>
                  <div className="h-4 flex-1 overflow-hidden rounded-full bg-primary/10">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${(vf.count / maxCount) * 100}%` }}
                    />
                  </div>
                  <span className="w-6 text-right text-[10px] tabular-nums text-muted-foreground">{vf.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent Sessions */}
        {recentSessions.length > 0 && (
          <div className="mt-4">
            <h3 className="text-xs font-bold text-foreground">Recent Sessions</h3>
            <div className="mt-2 flex flex-col gap-1">
              {recentSessions.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-lg p-2 hover:bg-muted/30">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-xs font-medium">{s.title}</span>
                    <span className="text-[10px] text-muted-foreground">{s.date}</span>
                  </div>
                  <Badge variant="outline" className="shrink-0 text-[8px] capitalize">{s.status}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!stats?.totalSessions && verseFreq.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <BarChart3Icon className="size-8 text-muted-foreground/30" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">No data yet</p>
              <p className="text-xs text-muted-foreground/60">Analytics will appear after your first sermon session.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
