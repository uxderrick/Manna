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

  const handleStart = async () => {
    try {
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

  const handleStop = async () => {
    const confirmed = await ask("Stop transcribing? This will end live audio capture.", { title: "Stop Transcription", kind: "warning" })
    if (!confirmed) return
    try {
      await invoke("stop_transcription")
      useTranscriptStore.getState().setTranscribing(false)
      useTranscriptStore.getState().setPartial("")
      useTranscriptStore.getState().setConnectionStatus("disconnected")
    } catch (e) {
      console.error("Failed to stop transcription:", e)
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
            variant="ghost"
            size="sm"
            className="gap-1.5 text-destructive hover:text-destructive"
            onClick={handleStop}
          >
            <MicOffIcon className="size-3.5" />
            Stop
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={handleStart}
            disabled={connectionStatus === "connecting"}
          >
            <MicIcon className="size-3.5" />
            {connectionStatus === "connecting" ? "Connecting…" : "Start transcribing"}
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
