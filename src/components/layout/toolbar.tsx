import { useState, useEffect } from "react"
import { useTheme } from "@/components/theme-provider"
import {
  useAudioStore,
  useTranscriptStore,
  useSessionStore,
} from "@/stores"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { LevelMeter } from "@/components/ui/level-meter"
import { LiveIndicator } from "@/components/ui/live-indicator"
import { SettingsDialog } from "@/components/settings-dialog"
import { Sun, Moon, GearSix } from "@phosphor-icons/react"
import { useSettingsDialogStore } from "@/lib/settings-dialog"

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
  const { theme, setTheme } = useTheme()
  const activeSession = useSessionStore((s) => s.activeSession)
  const isTranscribing = useTranscriptStore((s) => s.isTranscribing)
  const audioLevel = useAudioStore((s) => s.level)
  const openSettings = useSettingsDialogStore((s) => s.openSettings)

  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches)

  const toggleTheme = () => {
    setTheme(isDark ? "light" : "dark")
  }

  const isLive = activeSession?.status === "live"

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
            <Badge variant="outline" className="capitalize text-[0.5rem]">
              {activeSession.status}
            </Badge>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">No active session</span>
        )}
      </div>

      {/* Right side: controls */}
      <div className="flex items-center gap-1">
        {isTranscribing && audioLevel && (audioLevel.rms > 0 || audioLevel.peak > 0) && (
          <LevelMeter level={audioLevel.rms} className="mr-1" />
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={toggleTheme}
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        >
          {isDark ? <Moon size={16} /> : <Sun size={16} />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => openSettings()}
          aria-label="Open settings"
        >
          <GearSix size={16} />
        </Button>
        {/* SettingsDialog owns the dialog portal; its built-in trigger is hidden
            since we drive open/close via useSettingsDialogStore above. */}
        <span className="hidden">
          <SettingsDialog />
        </span>
      </div>
    </div>
  )
}
