// src/stores/service-plan-store.test.ts
import { beforeEach, describe, expect, it } from "vitest"

import { useServicePlanStore } from "./service-plan-store"
import type { PlanItem } from "@/types"

function mkItem(id: number, orderIndex: number, itemType: PlanItem["itemType"] = "blank"): PlanItem {
  return {
    id,
    planId: 1,
    planKind: "session",
    orderIndex,
    itemType,
    itemData: "{}",
    autoAdvanceSeconds: null,
  }
}

describe("service plan store", () => {
  beforeEach(() => {
    useServicePlanStore.setState({
      plan: null,
      activeItemId: null,
      pendingAdvanceTimerId: null,
      pendingAdvanceDeadline: null,
    })
  })

  it("setPlan replaces items and clears active state", () => {
    useServicePlanStore.setState({ activeItemId: 99 })
    useServicePlanStore.getState().setPlan({
      planId: 1,
      planKind: "session",
      items: [mkItem(1, 1), mkItem(2, 2)],
    })
    const s = useServicePlanStore.getState()
    expect(s.plan?.items).toHaveLength(2)
    expect(s.activeItemId).toBeNull()
  })

  it("setActiveItem records item id", () => {
    useServicePlanStore.getState().setPlan({
      planId: 1,
      planKind: "session",
      items: [mkItem(1, 1)],
    })
    useServicePlanStore.getState().setActiveItem(1)
    expect(useServicePlanStore.getState().activeItemId).toBe(1)
  })

  it("nextPlayableAfter skips over section items", () => {
    useServicePlanStore.getState().setPlan({
      planId: 1,
      planKind: "session",
      items: [
        mkItem(1, 1, "verse"),
        mkItem(2, 2, "section"),
        mkItem(3, 3, "section"),
        mkItem(4, 4, "song"),
      ],
    })
    const next = useServicePlanStore.getState().nextPlayableAfter(1)
    expect(next?.id).toBe(4)
  })

  it("nextPlayableAfter returns null at end of plan", () => {
    useServicePlanStore.getState().setPlan({
      planId: 1,
      planKind: "session",
      items: [mkItem(1, 1, "verse"), mkItem(2, 2, "section")],
    })
    expect(useServicePlanStore.getState().nextPlayableAfter(1)).toBeNull()
  })

  it("insertBetween yields midpoint order index", () => {
    expect(useServicePlanStore.getState().insertBetween(1, 2)).toBe(1.5)
    expect(useServicePlanStore.getState().insertBetween(null, 5)).toBe(4)
    expect(useServicePlanStore.getState().insertBetween(7, null)).toBe(8)
    expect(useServicePlanStore.getState().insertBetween(null, null)).toBe(1)
  })

  it("upsertItem replaces matching id, otherwise appends", () => {
    useServicePlanStore.getState().setPlan({
      planId: 1,
      planKind: "session",
      items: [mkItem(1, 1), mkItem(2, 2)],
    })
    useServicePlanStore.getState().upsertItem(mkItem(1, 1.5))
    expect(useServicePlanStore.getState().plan?.items[0].orderIndex).toBe(1.5)

    useServicePlanStore.getState().upsertItem(mkItem(3, 3))
    expect(useServicePlanStore.getState().plan?.items).toHaveLength(3)
    // Items should stay sorted by orderIndex after upsert.
    const ids = useServicePlanStore.getState().plan!.items.map((i) => i.id)
    expect(ids).toEqual([1, 2, 3])
  })

  it("removeItem drops item and clears activeItemId if it matched", () => {
    useServicePlanStore.getState().setPlan({
      planId: 1,
      planKind: "session",
      items: [mkItem(1, 1), mkItem(2, 2)],
    })
    useServicePlanStore.getState().setActiveItem(1)
    useServicePlanStore.getState().removeItem(1)
    const s = useServicePlanStore.getState()
    expect(s.plan?.items).toHaveLength(1)
    expect(s.activeItemId).toBeNull()
  })
})

describe("service plan store — auto-advance", () => {
  it("setPendingAdvance records timer id and deadline", () => {
    const fakeTimer = setTimeout(() => {}, 1000)
    useServicePlanStore.getState().setPendingAdvance(fakeTimer, Date.now() + 1000)
    const s = useServicePlanStore.getState()
    expect(s.pendingAdvanceTimerId).toBe(fakeTimer)
    expect(s.pendingAdvanceDeadline).toBeGreaterThan(Date.now())
    useServicePlanStore.getState().cancelPendingAdvance()
    expect(useServicePlanStore.getState().pendingAdvanceTimerId).toBeNull()
  })

  it("setPlan cancels pending advance", () => {
    const fakeTimer = setTimeout(() => {}, 1000)
    useServicePlanStore.getState().setPendingAdvance(fakeTimer, Date.now() + 1000)
    useServicePlanStore.getState().setPlan({
      planId: 1,
      planKind: "session",
      items: [],
    })
    expect(useServicePlanStore.getState().pendingAdvanceTimerId).toBeNull()
  })
})
