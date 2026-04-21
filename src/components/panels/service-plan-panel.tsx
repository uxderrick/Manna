// src/components/panels/service-plan-panel.tsx
import { useState, useEffect, useCallback } from "react"
import { CalendarDaysIcon } from "lucide-react"
import { useServicePlan } from "@/hooks/use-service-plan"
import { activatePlanItem } from "@/components/service-plan/activation-router"
import { AddItemMenu } from "@/components/service-plan/add-item-menu"
import { ServicePlanItem } from "./service-plan-item"
import { ServicePlanItemEditor } from "./service-plan-item-editor"
import type { PlanItem } from "@/types"

export function ServicePlanPanel() {
  const { plan, activeItemId, pendingAdvanceDeadline, setActiveItem, reorderItem } = useServicePlan()
  const [editing, setEditing] = useState<PlanItem | null>(null)

  /* Keyboard: ↑/↓ navigate, Enter activate, Del delete. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!plan || plan.items.length === 0) return
      const targets = ["INPUT", "TEXTAREA"]
      if (targets.includes((e.target as HTMLElement).tagName)) return

      const idx = plan.items.findIndex((i) => i.id === activeItemId)
      if (e.key === "ArrowDown") {
        e.preventDefault()
        const next = plan.items[Math.min(plan.items.length - 1, Math.max(0, idx + 1))]
        setActiveItem(next.id)
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        const prev = plan.items[Math.max(0, idx - 1)]
        setActiveItem(prev.id)
      } else if (e.key === "Enter") {
        if (idx >= 0) {
          e.preventDefault()
          activatePlanItem(plan.items[idx])
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [plan, activeItemId, setActiveItem])

  /* Drag: simple prev/next swap. Use HTML5 drag for v1 (no @dnd-kit hookup)
     to keep scope down. Future task can add keyboard-accessible drag. */
  const onDragReorder = useCallback(
    async (draggedId: number, prevId: number | null, nextId: number | null) => {
      if (!plan) return
      const dragged = plan.items.find((i) => i.id === draggedId)
      if (!dragged) return
      await reorderItem(dragged, prevId, nextId)
    },
    [plan, reorderItem],
  )

  if (!plan) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
        <CalendarDaysIcon className="size-6 opacity-40" />
        <p>Start a session to build a service plan.</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Service Plan
        </span>
        <AddItemMenu />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
        {plan.items.length === 0 && (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">
            Empty plan. Click <span className="font-medium">Add</span> to insert items.
          </div>
        )}
        {plan.items.map((item, idx) => (
          <DraggableRow
            key={item.id}
            item={item}
            isActive={activeItemId === item.id}
            pendingAdvanceDeadline={pendingAdvanceDeadline}
            onEdit={setEditing}
            onDragReorder={onDragReorder}
            prevId={idx > 0 ? plan.items[idx - 1].id : null}
            nextId={idx < plan.items.length - 1 ? plan.items[idx + 1].id : null}
          />
        ))}
      </div>

      <ServicePlanItemEditor item={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

interface RowProps {
  item: PlanItem
  isActive: boolean
  pendingAdvanceDeadline: number | null
  onEdit: (item: PlanItem) => void
  onDragReorder: (draggedId: number, prevId: number | null, nextId: number | null) => void
  prevId: number | null
  nextId: number | null
}

function DraggableRow({ item, isActive, pendingAdvanceDeadline, onEdit, onDragReorder, prevId }: RowProps) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", String(item.id))
        e.dataTransfer.effectAllowed = "move"
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = "move"
      }}
      onDrop={(e) => {
        e.preventDefault()
        const draggedId = Number(e.dataTransfer.getData("text/plain"))
        if (draggedId === item.id) return
        // Dropping on `item` means dragged goes between `prevId` and `item.id`
        // (i.e., dragged becomes the element whose next is `item`).
        onDragReorder(draggedId, prevId, item.id)
      }}
    >
      <ServicePlanItem
        item={item}
        isActive={isActive}
        pendingAdvanceDeadline={pendingAdvanceDeadline}
        onEdit={onEdit}
      />
    </div>
  )
}
