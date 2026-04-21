// src/components/service-plan/template-manager.tsx
import { useState, useEffect, useCallback } from "react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useServicePlan } from "@/hooks/use-service-plan"
import type { TemplateMeta } from "@/types"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TemplateManager({ open, onOpenChange }: Props) {
  const { listTemplates, loadTemplate, saveAsTemplate } = useServicePlan()
  const [templates, setTemplates] = useState<TemplateMeta[]>([])
  const [newName, setNewName] = useState("")

  const refresh = useCallback(() => {
    listTemplates().then(setTemplates).catch((e) => console.warn("listTemplates failed:", e))
  }, [listTemplates])

  useEffect(() => {
    if (open) refresh()
  }, [open, refresh])

  const save = async () => {
    if (!newName.trim()) return
    await saveAsTemplate(newName.trim())
    setNewName("")
    refresh()
  }

  const load = async (id: number) => {
    await loadTemplate(id)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Service Plan Templates</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div>
            <p className="mb-1 text-xs text-muted-foreground">
              Save current plan as template:
            </p>
            <div className="flex gap-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Template name"
              />
              <Button onClick={save}>Save</Button>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">Load template:</p>
            {templates.length === 0 && (
              <p className="text-xs text-muted-foreground">No templates yet.</p>
            )}
            {templates.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
              >
                <div>
                  <div className="font-medium">{t.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {t.itemCount} item{t.itemCount === 1 ? "" : "s"}
                  </div>
                </div>
                <Button size="sm" onClick={() => load(t.id)}>Load</Button>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
