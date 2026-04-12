import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { useEndSessionDialogStore } from "@/lib/end-session-dialog"
import { useSession } from "@/hooks/use-session"
import { useSessionStore } from "@/stores"

export function EndSessionDialog() {
  const { isOpen, sessionId, closeEndSession } = useEndSessionDialogStore()
  const { endSession, updateSummary } = useSession()
  const [summary, setSummary] = useState("")
  const [isEnding, setIsEnding] = useState(false)

  async function handleEndSession() {
    if (!sessionId) return
    setIsEnding(true)
    try {
      const updated = await endSession(sessionId)
      if (summary.trim()) {
        await updateSummary(sessionId, summary.trim())
      }
      useSessionStore.getState().setActiveSession(updated)
      setSummary("")
      closeEndSession()
    } finally {
      setIsEnding(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closeEndSession()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>End Session</DialogTitle>
          <DialogDescription>
            This will stop transcription and detection. You can't undo this.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <label className="text-sm font-medium">
            Summary <span className="text-muted-foreground">(optional)</span>
          </label>
          <textarea
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            rows={3}
            placeholder="Brief recap of this session…"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
        </div>

        <DialogFooter>
          <button
            className="rounded-md px-4 py-2 text-sm font-medium hover:bg-muted"
            onClick={closeEndSession}
          >
            Cancel
          </button>
          <button
            className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
            onClick={handleEndSession}
            disabled={isEnding}
          >
            {isEnding ? "Ending…" : "End Session"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
