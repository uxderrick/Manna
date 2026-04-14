import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { ask } from "@tauri-apps/plugin-dialog"
import {
  useAudioStore,
  useTranscriptStore,
  useSessionStore,
  useSettingsStore,
} from "@/stores"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { LevelMeter } from "@/components/ui/level-meter"
import { LiveIndicator } from "@/components/ui/live-indicator"
import { SettingsDialog } from "@/components/settings-dialog"
import { ApiKeyPrompt } from "@/components/ui/api-key-prompt"
import { MicIcon, MicOffIcon } from "lucide-react"

/* -------------------------------------------------------------------------- */
/*  Elapsed timer                                                             */
/* -------------------------------------------------------------------------- */

function formatElapsed(startedAt: string): string {
  const startMs = new Date(startedAt).getTime()
  const elapsedSec = Math.max(0, Math.floor((Date.now() - startMs) / 1000))
  const h = Math.floor(elapsedSec / 3600)
  const m = Math.floor((elapsedSec % 3600) / 60)
  const s = elapsedSec % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

function ElapsedTimer({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = useState(() => formatElapsed(startedAt))

  useEffect(() => {
    setElapsed(formatElapsed(startedAt))
    const interval = setInterval(() => {
      setElapsed(formatElapsed(startedAt))
    }, 1000)
    return () => clearInterval(interval)
  }, [startedAt])

  return (
    <span className="font-mono text-xs tabular-nums text-muted-foreground">
      {elapsed}
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/*  Toolbar                                                                   */
/* -------------------------------------------------------------------------- */

export function Toolbar() {
  const activeSession = useSessionStore((s) => s.activeSession)
  const isTranscribing = useTranscriptStore((s) => s.isTranscribing)
  const connectionStatus = useTranscriptStore((s) => s.connectionStatus)
  const audioLevel = useAudioStore((s) => s.level)
  const deepgramApiKey = useSettingsStore((s) => s.deepgramApiKey)
  const [showKeyPrompt, setShowKeyPrompt] = useState(false)

  const isLive = activeSession?.status === "live"

  const handleStartService = async () => {
    try {
      // Auto-create session if none active
      if (!useSessionStore.getState().activeSession) {
        const now = new Date()
        const date = now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" })
        const time = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
        const session = await invoke<any>("create_session", {
          request: {
            title: `${date} — ${time}`,
            date: now.toISOString().split("T")[0],
          }
        })
        const started = await invoke<any>("start_session", { id: session.id })
        useSessionStore.getState().setActiveSession(started)
      }

      // Start transcription
      useTranscriptStore.getState().setConnectionStatus("connecting")
      const settings = useSettingsStore.getState()
      await invoke("start_transcription", {
        apiKey: settings.sttProvider === "deepgram" ? (deepgramApiKey ?? "") : "",
        deviceId: settings.audioDeviceId,
        gain: settings.gain,
        provider: settings.sttProvider,
      })
      useTranscriptStore.getState().setTranscribing(true)
    } catch (e) {
      const errorMsg = String(e)
      useTranscriptStore.getState().setConnectionStatus("error")
      if (errorMsg.includes("No Deepgram API key")) {
        setShowKeyPrompt(true)
      } else {
        alert(errorMsg)
      }
    }
  }

  const handleEndService = async () => {
    const confirmed = await ask("End service? This will stop transcription and save the session.", { title: "End Service", kind: "warning" })
    if (!confirmed) return
    try {
      await invoke("stop_transcription")
      useTranscriptStore.getState().setTranscribing(false)
      useTranscriptStore.getState().setPartial("")
      useTranscriptStore.getState().setConnectionStatus("disconnected")

      // End the session
      const session = useSessionStore.getState().activeSession
      if (session) {
        await invoke("end_session", { id: session.id })
        useSessionStore.getState().setActiveSession(null)
      }
    } catch (e) {
      console.error("Failed to end service:", e)
    }
  }

  return (
    <div className="flex h-(--toolbar-height) items-center justify-between border-b border-border bg-card px-3">
      {/* Left side: session info */}
      <div className="flex items-center gap-2">
        {activeSession ? (
          <>
            {isLive && <LiveIndicator active={true} />}
            <span className="max-w-[200px] truncate text-xs font-medium text-foreground">
              {activeSession.title}
            </span>
            {isLive && activeSession.startedAt && (
              <ElapsedTimer startedAt={activeSession.startedAt} />
            )}
            <Badge variant="outline" className="capitalize text-[0.625rem]">
              {activeSession.status}
            </Badge>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">No active session</span>
        )}
      </div>

      {/* Right side: transcription control */}
      <div className="flex items-center gap-2">
        {isTranscribing && audioLevel && (audioLevel.rms > 0 || audioLevel.peak > 0) && (
          <LevelMeter level={audioLevel.rms} />
        )}
        {isTranscribing ? (
          <Button
            size="sm"
            className="gap-1.5 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={handleEndService}
          >
            <MicOffIcon className="size-3.5" />
            End Service
          </Button>
        ) : (
          <Button
            data-slot="start-service-btn"
            size="sm"
            className="gap-1.5 rounded-full"
            onClick={handleStartService}
            disabled={connectionStatus === "connecting"}
          >
            <MicIcon className="size-3.5" />
            {connectionStatus === "connecting" ? "Connecting…" : "Start Service"}
          </Button>
        )}
      </div>

      {/* SettingsDialog portal — driven by useSettingsDialogStore */}
      <span className="hidden">
        <SettingsDialog />
      </span>

      <ApiKeyPrompt
        open={showKeyPrompt}
        onOpenChange={setShowKeyPrompt}
        service="Deepgram"
        description="Live transcription needs a Deepgram API key. Add it in settings so the app can start listening."
      />
    </div>
  )
}
