import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { ask, open as openDialog } from "@tauri-apps/plugin-dialog"
import { FolderIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import type { SermonSession } from "@/types/session"

interface RecordingsLocation {
  path: string
  defaultPath: string
  isDefault: boolean
}

interface MoveOutcome {
  moved: number
  failed: string[]
}

export function StoragePanel() {
  const [sessions, setSessions] = useState<SermonSession[]>([])
  const [loading, setLoading] = useState(true)
  const [location, setLocation] = useState<RecordingsLocation | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [all, loc] = await Promise.all([
        invoke<SermonSession[]>("list_sessions"),
        invoke<RecordingsLocation>("get_recordings_location"),
      ])
      setSessions(all.filter((s) => s.audioPath))
      setLocation(loc)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  /** Point recordings at `dest`, offering to bring existing ones along. */
  const applyLocation = async (dest: string | null) => {
    setBusy(true)
    try {
      const hasExisting = sessions.length > 0
      if (hasExisting && dest !== null) {
        const move = await ask(
          `Move ${sessions.length} existing recording${sessions.length === 1 ? "" : "s"} to the new folder? ` +
            "Choose No to leave them where they are — they'll still play back.",
          { title: "Move existing recordings?", kind: "info" },
        )
        if (move) {
          const outcome = await invoke<MoveOutcome>("move_recordings_root", { dest })
          if (outcome.failed.length > 0) {
            toast.warning(
              `Moved ${outcome.moved}, but ${outcome.failed.length} could not be copied and were left in place.`,
            )
          } else if (outcome.moved > 0) {
            toast.success(`Moved ${outcome.moved} recording${outcome.moved === 1 ? "" : "s"}.`)
          }
        }
      }
      const next = await invoke<RecordingsLocation>("set_recordings_root", { path: dest })
      setLocation(next)
      await load()
    } catch (e) {
      toast.error(String(e))
    } finally {
      setBusy(false)
    }
  }

  const onPickLocation = async () => {
    const picked = await openDialog({ directory: true, multiple: false })
    if (typeof picked !== "string") return
    if (picked === location?.path) return
    await applyLocation(picked)
  }

  const onDelete = async (s: SermonSession) => {
    const ok = await ask(`Delete the recording for "${s.title}"?`, {
      title: "Delete audio",
      kind: "warning",
    })
    if (!ok) return
    await invoke("delete_session_audio", { sessionId: s.id })
    void load()
  }

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground">Loading…</p>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Recording location</h3>
        <p className="text-xs text-muted-foreground">
          Where new session recordings are saved. Point this at an external
          drive to keep large recordings off your startup disk. Notes,
          transcripts, and the image library always stay in the app folder.
        </p>
        <div className="flex items-center gap-3 rounded-md border border-border p-3">
          <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm" title={location?.path}>
              {location?.path}
            </div>
            <div className="text-xs text-muted-foreground">
              {location?.isDefault ? "Default location" : "Custom location"}
            </div>
          </div>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void onPickLocation()}>
            Change…
          </Button>
          {!location?.isDefault && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void applyLocation(null)}>
              Reset
            </Button>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Recordings</h3>
        <p className="text-xs text-muted-foreground">
          Audio recordings of past sessions. Delete any you no longer need to
          reclaim disk space; the session record, transcript, detections, and
          summary stay available.
        </p>
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recordings yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sessions.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{s.title}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {s.date} · {s.audioPath}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void onDelete(s)}
                  title="Delete recording"
                  aria-label={`Delete recording for ${s.title}`}
                >
                  <Trash2Icon className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
