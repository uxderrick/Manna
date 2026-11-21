// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { AddPlanSheet } from "./add-plan-sheet"

it("keeps template selection and adding-state protection working", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  const onAdd = vi.fn()
  const onOpenChange = vi.fn()
  try {
    await act(async () =>
      root.render(
        <AddPlanSheet
          open
          onOpenChange={onOpenChange}
          adding={false}
          onAdd={onAdd}
        />
      )
    )
    const prayer = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Add Prayer"]'
    )!
    expect(prayer).not.toBeNull()
    await act(async () => prayer.click())
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ type: "blank", prayer: expect.any(Object) })
    )
    await act(async () =>
      root.render(
        <AddPlanSheet open onOpenChange={onOpenChange} adding onAdd={onAdd} />
      )
    )
    expect(prayer.disabled).toBe(true)
    await act(async () => prayer.click())
    expect(onAdd).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
