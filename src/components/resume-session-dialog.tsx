import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useSessionStore, useTranscriptStore, useSettingsStore } from "@/stores"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { AlertCircleIcon } from "lucide-react"
import type { SermonSession } from "@/types/session"

/**
 * On app startup, checks for any sessions still marked as "live"
 * (orphaned from a crash or abrupt close) and offers to resume or end them.
 */
export function ResumeSessionDialog() {
  const [orphanedSession, setOrphanedSession] = useState<SermonSession | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    async function checkOrphaned() {
      try {
        const sessions = await invoke<SermonSession[]>("list_sessions")
        const live = sessions.find((s) => s.status === "live")
        if (live) {
          setOrphanedSession(live)
          setOpen(true)
        }
      } catch {
        // DB not ready yet or no sessions — ignore
      }
    }
    checkOrphaned()
  }, [])

  const handleResume = async () => {
    if (orphanedSession) {
      useSessionStore.getState().setActiveSession(orphanedSession)

      // Start transcription automatically
      try {
        useTranscriptStore.getState().setConnectionStatus("connecting")
        const settings = useSettingsStore.getState()
        const providerKey =
          settings.sttProvider === "deepgram"
            ? (settings.deepgramApiKey ?? "")
            : settings.sttProvider === "assemblyai"
              ? (settings.assemblyAiApiKey ?? "")
              : ""
        await invoke("start_transcription", {
          apiKey: providerKey,
          deviceId: settings.audioDeviceId,
          gain: settings.gain,
          provider: settings.sttProvider,
        })
        useTranscriptStore.getState().setTranscribing(true)
      } catch (e) {
        console.error("Failed to start transcription on resume:", e)
        useTranscriptStore.getState().setConnectionStatus("error")
      }
    }
    setOpen(false)
  }

  const handleEnd = async () => {
    if (orphanedSession) {
      try {
        await invoke("end_session", { id: orphanedSession.id })
      } catch {
        // already ended or error — ignore
      }
    }
    setOpen(false)
  }

  if (!orphanedSession) return null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-500/10">
            <AlertCircleIcon className="size-5 text-amber-500" />
          </div>
          <div>
            <DialogTitle className="text-sm font-bold">Session still active</DialogTitle>
            <DialogDescription className="mt-1 text-xs leading-relaxed">
              The previous session was not ended properly — likely due to the app closing unexpectedly.
            </DialogDescription>
          </div>
        </div>

        <div className="mt-3 rounded-lg bg-muted/30 px-3 py-2.5">
          <p className="text-xs font-semibold text-foreground">{orphanedSession.title}</p>
          <p className="mt-0.5 text-[0.625rem] text-muted-foreground">
            Started {orphanedSession.startedAt
              ? new Date(orphanedSession.startedAt).toLocaleString()
              : orphanedSession.date}
          </p>
        </div>

        <div className="mt-4 flex gap-2">
          <Button
            variant="outline"
            className="flex-1 rounded-full"
            onClick={handleEnd}
          >
            End Session
          </Button>
          <Button
            className="flex-1 rounded-full"
            onClick={handleResume}
          >
            Resume Session
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
