// @vitest-environment jsdom
import { act, useEffect } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { useSmsSend } from "./use-sms-send"
const api = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: api.invoke }))
it("previews a new draft with the prior send reference without sending automatically", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const old = {
    id: "previous",
    sessionId: 42,
    message: "Previous message",
    status: "COMPLETED",
    providerId: "accepted",
    recipientCount: 2,
    delivered: 2,
    totalFailed: 0,
  }
  const next = {
    ...old,
    id: "new-preview",
    message: "New message",
    status: "PREVIEWED",
    providerId: null,
  }
  api.invoke.mockImplementation(async (command: string) => {
    if (command === "get_comms360_settings")
      return { configured: true, senderId: "Church", contactListId: "list" }
    if (command === "get_contact_list_sms") return old
    if (command === "preview_contact_list_sms") return next
    throw new Error(`Unexpected command ${command}`)
  })
  let current!: ReturnType<typeof useSmsSend>
  function Harness() {
    const value = useSmsSend(42)
    useEffect(() => {
      current = value
    })
    return null
  }
  const root = createRoot(document.createElement("div"))
  try {
    await act(async () => root.render(<Harness />))
    await act(async () => current.preview("New message", "previous"))
    expect(api.invoke).toHaveBeenLastCalledWith("preview_contact_list_sms", {
      sessionId: 42,
      message: "New message",
      previousSendId: "previous",
    })
    expect(current.batch?.id).toBe("new-preview")
    expect(
      api.invoke.mock.calls.some(([name]) => name === "send_contact_list_sms")
    ).toBe(false)
  } finally {
    await act(async () => root.unmount())
  }
})
