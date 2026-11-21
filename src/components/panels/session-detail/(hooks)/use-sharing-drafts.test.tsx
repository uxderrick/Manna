// @vitest-environment jsdom
import { act, useEffect } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { SermonSummary } from "@/lib/summarize"
import { useSharingDrafts } from "./use-sharing-drafts"
const api = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: api.invoke }))
vi.mock("@/stores", () => ({
  useSettingsStore: {
    getState: () => ({ deepseekApiKey: "fictional-test-key" }),
  },
}))
vi.mock("../(lib)/slide-download", () => ({ renderSlideJpeg: vi.fn() }))
const original = {
  title: "Faith",
  recap:
    "Trust God.\n\nReflection:\nWill you trust?\n\nPrayer:\nLord, help us trust.",
  sms: "Trust God today.",
}
let current: ReturnType<typeof useSharingDrafts>
let root: Root
let element: HTMLDivElement
function Harness() {
  const sharing = useSharingDrafts(12)
  useEffect(() => {
    current = sharing
  })
  return null
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  api.invoke
    .mockReset()
    .mockImplementation(async (command: string) =>
      command === "get_sharing_draft"
        ? original
        : command === "get_session_publication"
          ? null
          : original
    )
  element = document.createElement("div")
  root = createRoot(element)
  await act(async () => {
    root.render(<Harness />)
  })
})
afterEach(async () => {
  await act(async () => root.unmount())
})
const summary = { big_idea: "Trust God" } as SermonSummary
it.each(["sms", "recap"] as const)(
  "reports unchanged %s instead of silently succeeding",
  async (scope) => {
    await act(async () => {
      await current.generate("Faith", null, scope)
    })
    expect(current.error).toContain("same wording")
    expect(current.draft).toEqual(original)
  }
)
it.each(["sms", "recap"] as const)(
  "passes the current %s draft and preserves the other tab",
  async (scope) => {
    const next = {
      title: "Faith",
      recap: "Walk in faith this week.",
      sms: "Take one step of faith today.",
    }
    api.invoke.mockResolvedValueOnce(next)
    await act(async () => {
      await current.generate("Faith", null, scope)
    })
    expect(api.invoke).toHaveBeenLastCalledWith(
      "generate_sharing_draft",
      expect.objectContaining({
        previousDraft: expect.objectContaining(
          scope === "sms" ? { sms: original.sms } : { recap: original.recap }
        ),
      })
    )
    expect(current.draft.sms).toBe(scope === "sms" ? next.sms : original.sms)
    expect(current.draft.recap).toBe(
      scope === "recap" ? next.recap : original.recap
    )
  }
)

it("passes the current linked SMS for comparison and applies its replacement", async () => {
  const url = "https://sermon.ewcadentan.com/s/d89b7ee6b9064643"
  api.invoke.mockImplementation(async (command: string) => {
    if (command === "get_sharing_draft") return original
    if (command === "get_session_publication")
      return { id: "recap", url, publishedAt: null }
    if (command === "generate_sharing_draft") return original
    if (command === "generate_linked_sms")
      return `Walk by faith.\n\nRead this week's sermon recap:\n${url}`
  })
  await act(async () => current.retry())
  await act(async () => {
    await current.generate("Faith", null, "sms")
  })
  expect(api.invoke).toHaveBeenLastCalledWith(
    "generate_linked_sms",
    expect.objectContaining({ previousSms: original.sms, url })
  )
  expect(current.error).toBeNull()
  expect(current.draft.sms).toContain("Walk by faith.")
  expect(current.draft.sms).toContain(`recap:\n${url}`)
  expect(current.draft.recap).toBe(original.recap)
})

const alternatives = [
  { approach: "encouragement", message: "God values your obedience." },
  { approach: "reflection", message: "What distracts you from obeying God?" },
  { approach: "action", message: "Set aside one distraction this week." },
]
it("generates three options without replacing the draft, then keeps edits on regeneration", async () => {
  api.invoke.mockResolvedValueOnce(alternatives)
  await act(async () => {
    await current.generateSmsAlternatives(summary, "Faith")
  })
  expect(current.smsAlternatives).toEqual(alternatives)
  expect(current.draft).toEqual(original)
  expect(api.invoke).toHaveBeenLastCalledWith(
    "generate_sms_alternatives",
    expect.objectContaining({ previousMessages: [original.sms], url: null })
  )
  await act(async () =>
    current.update("sms", "My selected and edited message.")
  )
  api.invoke.mockResolvedValueOnce(alternatives)
  await act(async () => {
    await current.generateSmsAlternatives(summary, "Faith")
  })
  expect(current.draft.sms).toBe("My selected and edited message.")
  expect(current.draft.recap).toBe(original.recap)
  expect(api.invoke).toHaveBeenLastCalledWith(
    "generate_sms_alternatives",
    expect.objectContaining({
      previousMessages: [
        "My selected and edited message.",
        ...alternatives.map((option) => option.message),
      ],
    })
  )
})
it("preserves options and the selected draft when generation fails", async () => {
  api.invoke.mockResolvedValueOnce(alternatives)
  await act(async () => {
    await current.generateSmsAlternatives(summary, "Faith")
  })
  api.invoke.mockRejectedValueOnce(new Error("Network unavailable"))
  await act(async () => {
    await current.generateSmsAlternatives(summary, "Faith")
  })
  expect(current.smsAlternatives).toEqual(alternatives)
  expect(current.draft).toEqual(original)
  expect(current.error).toContain("Network unavailable")
})

it("requests the saved session transcript instead of sending a rewritten summary", async () => {
  api.invoke.mockResolvedValueOnce({
    ...original,
    recap: "Set your mind. This one is deliberate.",
  })
  await act(async () => {
    await current.generate("Faith", null, "recap")
  })
  const args = api.invoke.mock.calls.find(
    ([command]) => command === "generate_sharing_draft"
  )?.[1]
  expect(args.sessionId).toBe(12)
  expect(args).not.toHaveProperty("summary")
})
