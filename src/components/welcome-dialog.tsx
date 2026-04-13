import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useSettingsStore } from "@/stores"
import { persistOnboardingComplete } from "@/stores/settings-store"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Monitor, MonitorOff } from "lucide-react"

export function WelcomeDialog() {
  const onboardingComplete = useSettingsStore((s) => s.onboardingComplete)
  // setOnboardingComplete handled by persistOnboardingComplete
  const [open, setOpen] = useState(false)
  const [monitors, setMonitors] = useState<Array<{ name: string; width: number; height: number }>>([])

  useEffect(() => {
    if (!onboardingComplete) {
      // Small delay so the app renders first
      const timer = setTimeout(() => setOpen(true), 500)
      return () => clearTimeout(timer)
    }
  }, [onboardingComplete])

  useEffect(() => {
    if (open) {
      invoke<Array<{ name: string; width: number; height: number }>>("list_monitors")
        .then(setMonitors)
        .catch(() => {})
    }
  }, [open])

  const handleStartBroadcast = async () => {
    try {
      await invoke("ensure_broadcast_window", { outputId: "main" })
      const targetIdx = monitors.length > 1 ? 1 : 0
      await invoke("open_broadcast_window", { outputId: "main", monitorIndex: targetIdx })
    } catch (e) {
      console.error("Failed to open broadcast window:", e)
    }
    persistOnboardingComplete()
    setOpen(false)
  }

  const handleSkip = () => {
    persistOnboardingComplete()
    setOpen(false)
  }

  const hasExternalMonitor = monitors.length > 1

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleSkip() }}>
      <DialogContent className="max-w-md">
        <DialogTitle className="text-lg font-semibold">Welcome to Manna</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          Real-time Bible verse detection for live sermons.
        </DialogDescription>

        <div className="mt-4 flex flex-col gap-3">
          <p className="text-sm text-foreground">
            Would you like to start the broadcast window for your projector or external screen?
          </p>

          {hasExternalMonitor ? (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
              <p className="text-xs text-primary">
                External monitor detected: {monitors[1]?.name || "Display 2"} ({monitors[1]?.width}x{monitors[1]?.height})
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">
                No external monitor detected. You can connect one later and start broadcast from the menu.
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              className="flex-1 gap-2 rounded-full"
              onClick={handleStartBroadcast}
            >
              <Monitor className="size-4" />
              Start Broadcast
            </Button>
            <Button
              variant="outline"
              className="flex-1 gap-2 rounded-full"
              onClick={handleSkip}
            >
              <MonitorOff className="size-4" />
              Skip for Now
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
