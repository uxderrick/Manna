// src/hooks/use-service-plan.ts
import { useCallback, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import {
  useServicePlanStore,
} from "@/stores/service-plan-store"
import { useSessionStore } from "@/stores"
import type {
  Plan,
  PlanItem,
  PlanItemPayload,
  PlanItemType,
  TemplateMeta,
} from "@/types"

export function useServicePlan() {
  const store = useServicePlanStore()
  const activeSessionId = useSessionStore((s) => s.activeSession?.id ?? null)

  /* Load plan whenever active session changes. */
  useEffect(() => {
    if (activeSessionId == null) {
      store.setPlan(null)
      return
    }
    let cancelled = false
    invoke<Plan>("plan_get", { planId: activeSessionId, planKind: "session" })
      .then((plan) => {
        if (!cancelled) store.setPlan(plan)
      })
      .catch((e) => console.warn("plan_get failed:", e))
    return () => {
      cancelled = true
    }
    // store is stable (zustand); depend only on session id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId])

  const addItem = useCallback(
    async (itemType: PlanItemType, payload: PlanItemPayload) => {
      if (activeSessionId == null) return
      const plan = useServicePlanStore.getState().plan
      const lastIdx = plan && plan.items.length > 0
        ? plan.items[plan.items.length - 1].orderIndex
        : 0
      const orderIndex = lastIdx + 1
      const item = await invoke<PlanItem>("plan_add_item", {
        planId: activeSessionId,
        planKind: "session",
        itemType,
        itemData: JSON.stringify(payload),
        orderIndex,
        autoAdvanceSeconds: null,
      })
      useServicePlanStore.getState().upsertItem(item)
    },
    [activeSessionId],
  )

  const updateItem = useCallback(
    async (item: PlanItem, payload: PlanItemPayload, autoAdvanceSeconds: number | null) => {
      await invoke("plan_update_item", {
        itemId: item.id,
        itemData: JSON.stringify(payload),
        autoAdvanceSeconds,
      })
      useServicePlanStore.getState().upsertItem({
        ...item,
        itemData: JSON.stringify(payload),
        autoAdvanceSeconds,
      })
    },
    [],
  )

  const deleteItem = useCallback(async (itemId: number) => {
    await invoke("plan_delete_item", { itemId })
    useServicePlanStore.getState().removeItem(itemId)
  }, [])

  const reorderItem = useCallback(async (item: PlanItem, prevId: number | null, nextId: number | null) => {
    const plan = useServicePlanStore.getState().plan
    if (!plan) return
    const prevIdx = prevId != null ? plan.items.find((i) => i.id === prevId)?.orderIndex ?? null : null
    const nextIdx = nextId != null ? plan.items.find((i) => i.id === nextId)?.orderIndex ?? null : null
    const newIdx = useServicePlanStore.getState().insertBetween(prevIdx, nextIdx)
    await invoke("plan_reorder_item", { itemId: item.id, newOrderIndex: newIdx })
    useServicePlanStore.getState().upsertItem({ ...item, orderIndex: newIdx })
  }, [])

  const listTemplates = useCallback(
    () => invoke<TemplateMeta[]>("plan_list_templates"),
    [],
  )

  const loadTemplate = useCallback(
    async (templateId: number) => {
      if (activeSessionId == null) return
      await invoke("plan_load_template_into_session", {
        sessionId: activeSessionId,
        templateId,
      })
      const plan = await invoke<Plan>("plan_get", {
        planId: activeSessionId,
        planKind: "session",
      })
      useServicePlanStore.getState().setPlan(plan)
    },
    [activeSessionId],
  )

  const saveAsTemplate = useCallback(
    async (name: string, notes?: string) => {
      if (activeSessionId == null) return null
      return await invoke<number>("plan_save_session_as_template", {
        sessionId: activeSessionId,
        name,
        notes: notes ?? null,
      })
    },
    [activeSessionId],
  )

  const cloneFromSession = useCallback(
    async (sourceSessionId: number) => {
      if (activeSessionId == null) return
      await invoke("plan_clone_from_session", {
        targetSessionId: activeSessionId,
        sourceSessionId,
      })
      const plan = await invoke<Plan>("plan_get", {
        planId: activeSessionId,
        planKind: "session",
      })
      useServicePlanStore.getState().setPlan(plan)
    },
    [activeSessionId],
  )

  return {
    plan: store.plan,
    activeItemId: store.activeItemId,
    pendingAdvanceDeadline: store.pendingAdvanceDeadline,
    setActiveItem: store.setActiveItem,
    addItem,
    updateItem,
    deleteItem,
    reorderItem,
    listTemplates,
    loadTemplate,
    saveAsTemplate,
    cloneFromSession,
  }
}
