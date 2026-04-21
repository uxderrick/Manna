// src/stores/service-plan-store.ts
import { create } from "zustand"
import type { Plan, PlanItem } from "@/types"

interface ServicePlanState {
  plan: Plan | null
  activeItemId: number | null
  pendingAdvanceTimerId: ReturnType<typeof setTimeout> | null
  pendingAdvanceDeadline: number | null

  setPlan: (plan: Plan | null) => void
  setActiveItem: (itemId: number | null) => void
  upsertItem: (item: PlanItem) => void
  removeItem: (itemId: number) => void

  /** Returns the next item after `itemId` that is playable (not a `section`). */
  nextPlayableAfter: (itemId: number) => PlanItem | null

  /**
   * Compute a fractional order index between two existing indices. Use null for
   * "no neighbor on that side". Falls back to sensible defaults when inserting
   * at the head, tail, or into an empty list.
   */
  insertBetween: (prev: number | null, next: number | null) => number

  setPendingAdvance: (timerId: ReturnType<typeof setTimeout> | null, deadlineMs: number | null) => void
  cancelPendingAdvance: () => void
}

function sortedByOrderIndex(items: PlanItem[]): PlanItem[] {
  return [...items].sort((a, b) => a.orderIndex - b.orderIndex)
}

export const useServicePlanStore = create<ServicePlanState>((set, get) => ({
  plan: null,
  activeItemId: null,
  pendingAdvanceTimerId: null,
  pendingAdvanceDeadline: null,

  setPlan: (plan) => {
    const { pendingAdvanceTimerId } = get()
    if (pendingAdvanceTimerId) clearTimeout(pendingAdvanceTimerId)
    set({
      plan: plan ? { ...plan, items: sortedByOrderIndex(plan.items) } : null,
      activeItemId: null,
      pendingAdvanceTimerId: null,
      pendingAdvanceDeadline: null,
    })
  },

  setActiveItem: (itemId) => set({ activeItemId: itemId }),

  upsertItem: (item) =>
    set((state) => {
      if (!state.plan) return state
      const existingIdx = state.plan.items.findIndex((i) => i.id === item.id)
      const nextItems =
        existingIdx === -1
          ? [...state.plan.items, item]
          : state.plan.items.map((i) => (i.id === item.id ? item : i))
      return { plan: { ...state.plan, items: sortedByOrderIndex(nextItems) } }
    }),

  removeItem: (itemId) =>
    set((state) => {
      if (!state.plan) return state
      return {
        plan: {
          ...state.plan,
          items: state.plan.items.filter((i) => i.id !== itemId),
        },
        activeItemId: state.activeItemId === itemId ? null : state.activeItemId,
      }
    }),

  nextPlayableAfter: (itemId) => {
    const plan = get().plan
    if (!plan) return null
    const idx = plan.items.findIndex((i) => i.id === itemId)
    if (idx === -1) return null
    for (let j = idx + 1; j < plan.items.length; j++) {
      if (plan.items[j].itemType !== "section") return plan.items[j]
    }
    return null
  },

  insertBetween: (prev, next) => {
    if (prev != null && next != null) return (prev + next) / 2
    if (prev == null && next != null) return next - 1
    if (prev != null && next == null) return prev + 1
    return 1
  },

  setPendingAdvance: (timerId, deadlineMs) =>
    set({ pendingAdvanceTimerId: timerId, pendingAdvanceDeadline: deadlineMs }),

  cancelPendingAdvance: () => {
    const { pendingAdvanceTimerId } = get()
    if (pendingAdvanceTimerId) clearTimeout(pendingAdvanceTimerId)
    set({ pendingAdvanceTimerId: null, pendingAdvanceDeadline: null })
  },
}))
