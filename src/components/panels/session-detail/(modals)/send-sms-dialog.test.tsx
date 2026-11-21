// @vitest-environment jsdom
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { SendSmsDialog } from "./send-sms-dialog"
const sms = vi.hoisted(() => ({
  mode: "idle",
  settings: { configured: true, senderId: "Church", contactListId: "list" },
  batch: {
    id: "previous",
    status: "COMPLETED",
    providerId: "accepted",
    message: "Old message",
    senderId: "Church",
    contactListId: "list",
    recipientCount: 2,
    totalParts: 2,
    estimatedCost: 0.1,
    currency: "CREDITS",
    totalSent: 2,
    totalFailed: 0,
    delivered: 2,
    error: null,
  },
  error: "",
  preview: vi.fn(),
  reset: vi.fn(),
  refresh: vi.fn(),
  send: vi.fn(),
}))
vi.mock("../(hooks)/use-sms-send", () => ({ useSmsSend: () => sms }))
vi.mock("@/components/ui/dialog", () => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  )
  return Object.fromEntries(
    [
      "DialogContent",
      "DialogHeader",
      "DialogTitle",
      "DialogDescription",
      "DialogFooter",
    ].map((name) => [name, Wrapper])
  )
})
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  sms.batch.status = "COMPLETED"
  container = document.createElement("div")
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
})
function render(message = "New message") {
  act(() => root.render(<SendSmsDialog sessionId={42} message={message} />))
  return [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Send another message"
  )
}
it("starts a new cost preview for the current draft without sending it", () => {
  const button = render()!
  expect(button).toBeDefined()
  act(() => button.click())
  expect(sms.preview).toHaveBeenCalledWith("New message", "previous")
  expect(sms.send).not.toHaveBeenCalled()
})
it("hides the new-message action while the previous outcome is unknown", () => {
  sms.batch.status = "UNKNOWN"
  expect(render()).toBeUndefined()
})
it("keeps the one-part message limit for the new-message action", () => {
  const button = render("x".repeat(161))!
  expect(button.disabled).toBe(true)
  act(() => button.click())
  expect(sms.preview).not.toHaveBeenCalled()
})
