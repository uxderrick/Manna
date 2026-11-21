// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { ConnectionOnly } from "@/components/settings/(components)/connection-only"
const api = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: api.invoke }))
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
let cleanup = () => {}
afterEach(() => {
  cleanup()
  api.invoke.mockReset()
})
async function render() {
  const container = document.createElement("div")
  const root = createRoot(container)
  cleanup = () => {
    act(() => root.unmount())
  }
  await act(async () =>
    root.render(
      <>
        <button>Copy recap</button>
        <ConnectionOnly kind="publishing">
          <button>Publish recap</button>
        </ConnectionOnly>
        <ConnectionOnly kind="sms">
          <button>Send SMS</button>
        </ConnectionOnly>
      </>
    )
  )
  return container
}
it("keeps copy available and hides both direct actions without connections", async () => {
  api.invoke.mockResolvedValue({ publishing: false, sms: false })
  const container = await render()
  expect(container.textContent).toBe("Copy recap")
})
it("enables only the locally configured connection", async () => {
  api.invoke.mockResolvedValue({ publishing: true, sms: false })
  const container = await render()
  expect(container.textContent).toBe("Copy recapPublish recap")
})
it("fails closed without blocking copy when settings cannot be read", async () => {
  api.invoke.mockRejectedValue(new Error("Unreadable local config"))
  expect((await render()).textContent).toBe("Copy recap")
})
