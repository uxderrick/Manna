import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useSettingsStore } from "@/stores"
import { persistEnabledHymnals, persistOnboardingComplete } from "@/stores/settings-store"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Monitor, MonitorOff } from "lucide-react"
import { HymnalPickerStep } from "@/components/onboarding/hymnal-picker-step"
import { ApiKeyStep } from "@/components/onboarding/api-key-step"

type Step = "monitor" | "hymnals" | "api-key"

export function WelcomeDialog() {
  const onboardingComplete = useSettingsStore((s) => s.onboardingComplete)
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>("monitor")
  const [monitors, setMonitors] = useState<Array<{ name: string; width: number; height: number }>>([])

  useEffect(() => {
    if (!onboardingComplete) {
      const timer = setTimeout(() => setOpen(true), 500)
      return () => clearTimeout(timer)
    }
  }, [onboardingComplete])

  useEffect(() => {
    if (open && step === "monitor") {
      invoke<Array<{ name: string; width: number; height: number }>>("list_monitors")
        .then(setMonitors)
        .catch(() => {})
    }
  }, [open, step])

  const advanceToHymnals = async () => {
    // Optional: start broadcast window if picked, but don't block wizard.
    setStep("hymnals")
  }

  const handleStartBroadcast = async () => {
    try {
      await invoke("ensure_broadcast_window", { outputId: "main" })
      const targetIdx = monitors.length > 1 ? 1 : 0
      await invoke("open_broadcast_window", { outputId: "main", monitorIndex: targetIdx })
    } catch (e) {
      console.error("Failed to open broadcast window:", e)
    }
    advanceToHymnals()
  }

  const handleSkipMonitor = () => {
    advanceToHymnals()
  }

  const handleHymnalsContinue = async (enabled: string[]) => {
    await persistEnabledHymnals(enabled)
    for (const id of enabled) {
      try {
        await invoke("seed_hymnal", { hymnalId: id })
      } catch (e) {
        console.warn(`[onboarding] seed ${id} failed:`, e)
      }
    }
    const { useSongStore } = await import("@/stores/song-store")
    await useSongStore.getState().hydrateSongs()
    // Advance to API key step — don't close wizard yet.
    setStep("api-key")
  }

  const handleApiKeyContinue = async () => {
    await persistOnboardingComplete()
    setOpen(false)
  }

  const closeWizard = () => {
    // Closing via backdrop/esc on any step completes onboarding (user opted out).
    persistOnboardingComplete()
    setOpen(false)
  }

  const hasExternalMonitor = monitors.length > 1

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) closeWizard() }}>
      <DialogContent className="max-w-md">
        {step === "monitor" && (
          <>
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
                  onClick={handleSkipMonitor}
                >
                  <MonitorOff className="size-4" />
                  Skip for Now
                </Button>
              </div>
            </div>
          </>
        )}

        {step === "hymnals" && (
          <>
            {/* Dialog requires a title for accessibility; provided but visually de-emphasized */}
            <DialogTitle className="sr-only">Pick your hymnals</DialogTitle>
            <DialogDescription className="sr-only">
              Choose which hymnals to enable.
            </DialogDescription>
            <HymnalPickerStep onContinue={handleHymnalsContinue} />
          </>
        )}

        {step === "api-key" && (
          <>
            <DialogTitle className="sr-only">Speech recognition</DialogTitle>
            <DialogDescription className="sr-only">
              Configure your transcription provider.
            </DialogDescription>
            <ApiKeyStep onContinue={handleApiKeyContinue} />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
