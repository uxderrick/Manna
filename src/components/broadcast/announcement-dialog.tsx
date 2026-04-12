import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { useAnnouncementDialogStore } from "@/lib/announcement-dialog"
import { useBroadcastStore } from "@/stores"

const DURATIONS = [
  { label: "5 seconds", value: 5 },
  { label: "10 seconds", value: 10 },
  { label: "15 seconds", value: 15 },
  { label: "30 seconds", value: 30 },
  { label: "Manual dismiss", value: null },
] as const

export function AnnouncementDialog() {
  const { isOpen, closeAnnouncement } = useAnnouncementDialogStore()
  const [text, setText] = useState("")
  const [duration, setDuration] = useState<number | null>(10)
  const [position, setPosition] = useState<"top" | "bottom">("bottom")
  const [style, setStyle] = useState<"info" | "urgent">("info")

  function handleSend() {
    if (!text.trim()) return
    useBroadcastStore.getState().sendAnnouncement({
      text: text.trim(),
      position,
      style,
      duration,
    })
    setText("")
    setDuration(10)
    setPosition("bottom")
    setStyle("info")
    closeAnnouncement()
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closeAnnouncement()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Announcement</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Message</label>
            <input
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="Type your announcement…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Duration</label>
            <select
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={duration ?? "manual"}
              onChange={(e) =>
                setDuration(e.target.value === "manual" ? null : Number(e.target.value))
              }
            >
              {DURATIONS.map((d) => (
                <option key={d.label} value={d.value ?? "manual"}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Position</label>
            <div className="flex gap-2">
              <button
                className={`rounded-md px-3 py-1.5 text-sm ${position === "top" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                onClick={() => setPosition("top")}
              >
                Top
              </button>
              <button
                className={`rounded-md px-3 py-1.5 text-sm ${position === "bottom" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                onClick={() => setPosition("bottom")}
              >
                Bottom
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Style</label>
            <div className="flex gap-2">
              <button
                className={`rounded-md px-3 py-1.5 text-sm ${style === "info" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                onClick={() => setStyle("info")}
              >
                Info
              </button>
              <button
                className={`rounded-md px-3 py-1.5 text-sm ${style === "urgent" ? "bg-destructive text-destructive-foreground" : "bg-muted text-muted-foreground"}`}
                onClick={() => setStyle("urgent")}
              >
                Urgent
              </button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <button
            className="rounded-md px-4 py-2 text-sm font-medium hover:bg-muted"
            onClick={closeAnnouncement}
          >
            Cancel
          </button>
          <button
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            onClick={handleSend}
            disabled={!text.trim()}
          >
            Send
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
