import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { PlanItem, PlanItemPayload } from "@/types"
import { parsePlanItem } from "@/types"
import { useServicePlan } from "@/hooks/use-service-plan"

interface Props {
  item: PlanItem | null
  onClose: () => void
}

export function ServicePlanItemEditor({ item, onClose }: Props) {
  const { updateItem } = useServicePlan()
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [label, setLabel] = useState("")
  const [autoAdvance, setAutoAdvance] = useState<string>("")

  useEffect(() => {
    if (!item) return
    const parsed = parsePlanItem(item)
    if (parsed?.type === "announcement") {
      setTitle(parsed.title)
      setBody(parsed.body)
    } else if (parsed?.type === "section") {
      setLabel(parsed.label)
    }
    setAutoAdvance(item.autoAdvanceSeconds?.toString() ?? "")
  }, [item])

  if (!item) return null
  const parsed = parsePlanItem(item)
  if (!parsed) return null

  const save = async () => {
    let payload: PlanItemPayload
    if (parsed.type === "announcement") {
      payload = { type: "announcement", title, body }
    } else if (parsed.type === "section") {
      payload = { type: "section", label }
    } else {
      onClose()
      return
    }
    const seconds = autoAdvance.trim() === "" ? null : Number(autoAdvance)
    await updateItem(item, payload, Number.isFinite(seconds) ? (seconds as number | null) : null)
    onClose()
  }

  return (
    <Dialog open={item != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Edit {parsed.type === "announcement" ? "announcement" : "section"}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {parsed.type === "announcement" ? (
            <>
              <div>
                <label className="text-xs font-medium">Title</label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium">Body</label>
                <textarea
                  className="mt-1 min-h-[100px] w-full rounded-md border bg-transparent p-2 text-sm"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
              </div>
            </>
          ) : (
            <div>
              <label className="text-xs font-medium">Label</label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
          )}
          <div>
            <label className="text-xs font-medium">Auto-advance (seconds, blank = manual)</label>
            <Input
              type="number"
              min={0}
              value={autoAdvance}
              onChange={(e) => setAutoAdvance(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
