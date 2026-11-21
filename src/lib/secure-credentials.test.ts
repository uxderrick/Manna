import { beforeEach, expect, it, vi } from "vitest"
const invoke = vi.hoisted(() => vi.fn())
vi.mock("@tauri-apps/api/core", () => ({ invoke }))
let loadCredential: typeof import("./secure-credentials").loadCredential
let saveCredential: typeof import("./secure-credentials").saveCredential
const disk = new Map<string, unknown>()
const store = {
  get: async <T>(name: string) => disk.get(name) as T | undefined,
  delete: vi.fn(async (name: string) => disk.delete(name)),
  save: vi.fn(async () => {}),
}
beforeEach(async () => {
  disk.clear()
  vi.clearAllMocks()
  invoke.mockReset()
  vi.resetModules()
  ;({ loadCredential, saveCredential } = await import("./secure-credentials"))
})
it("copies and verifies legacy keys before deleting their JSON value", async () => {
  disk.set("deepgramApiKey", "synthetic-key")
  invoke.mockResolvedValueOnce(null).mockImplementationOnce(async () => {
    expect(disk.get("deepgramApiKey")).toBe("synthetic-key")
  })
  expect(await loadCredential(store, "deepgramApiKey", vi.fn())).toBe(
    "synthetic-key"
  )
  expect(invoke).toHaveBeenLastCalledWith("set_provider_credential", {
    name: "deepgramApiKey",
    value: "synthetic-key",
  })
  expect(disk.has("deepgramApiKey")).toBe(false)
  expect(store.save).toHaveBeenCalled()
})
it("keeps the legacy key when secure storage fails", async () => {
  disk.set("deepgramApiKey", "synthetic-key")
  invoke.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("locked"))
  const warn = vi.fn()
  expect(await loadCredential(store, "deepgramApiKey", warn)).toBe(
    "synthetic-key"
  )
  expect(disk.get("deepgramApiKey")).toBe("synthetic-key")
  expect(store.delete).not.toHaveBeenCalled()
  expect(warn).toHaveBeenCalledOnce()
})
it("uses an existing secure key and removes an old plaintext copy", async () => {
  disk.set("deepgramApiKey", "old-key")
  invoke.mockResolvedValue("secure-key")
  expect(await loadCredential(store, "deepgramApiKey", vi.fn())).toBe(
    "secure-key"
  )
  expect(invoke).toHaveBeenCalledTimes(1)
  expect(disk.size).toBe(0)
})
it("does not remove a saved key when replacement fails", async () => {
  disk.set("deepgramApiKey", "old-key")
  invoke.mockRejectedValue(new Error("locked"))
  await expect(
    saveCredential(store, "deepgramApiKey", "new-key")
  ).rejects.toThrow()
  expect(disk.get("deepgramApiKey")).toBe("old-key")
})
it("serializes migration and a later edit, including removal", async () => {
  disk.set("deepgramApiKey", "old-key")
  invoke.mockResolvedValueOnce(null).mockResolvedValue(undefined)
  await Promise.all([
    loadCredential(store, "deepgramApiKey", vi.fn()),
    saveCredential(store, "deepgramApiKey", "new-key"),
    saveCredential(store, "deepgramApiKey", null),
  ])
  expect(invoke.mock.calls.map((call) => call[1].value)).toEqual([
    undefined,
    "old-key",
    "new-key",
    null,
  ])
})

it("keeps the secure value usable if removing an old JSON copy fails", async () => {
  disk.set("deepgramApiKey", "old-key")
  invoke.mockResolvedValue("secure-key")
  store.delete.mockRejectedValueOnce(new Error("disk failure"))
  const warn = vi.fn()
  expect(await loadCredential(store, "deepgramApiKey", warn)).toBe("secure-key")
  expect(disk.get("deepgramApiKey")).toBe("old-key")
  expect(warn).toHaveBeenCalledOnce()
})

it("reads each secure key only once across repeated startup hydration", async () => {
  invoke.mockResolvedValue("secure-key")
  const warn = vi.fn()
  expect(
    await Promise.all([
      loadCredential(store, "deepgramApiKey", warn),
      loadCredential(store, "deepgramApiKey", warn),
    ])
  ).toEqual(["secure-key", "secure-key"])
  expect(await loadCredential(store, "deepgramApiKey", warn)).toBe("secure-key")
  expect(invoke).toHaveBeenCalledTimes(1)
})
it("does not repeatedly prompt after the user denies access during this launch", async () => {
  invoke.mockRejectedValue(new Error("Access denied"))
  const warn = vi.fn()
  await loadCredential(store, "deepseekApiKey", warn)
  await loadCredential(store, "deepseekApiKey", warn)
  expect(invoke).toHaveBeenCalledTimes(1)
  expect(warn).toHaveBeenCalledOnce()
})
it("uses an edited key from memory after a successful secure save", async () => {
  invoke.mockResolvedValueOnce("old-key").mockResolvedValue(undefined)
  await loadCredential(store, "deepseekApiKey", vi.fn())
  await saveCredential(store, "deepseekApiKey", "new-key")
  expect(await loadCredential(store, "deepseekApiKey", vi.fn())).toBe("new-key")
  expect(invoke.mock.calls.map((call) => call[0])).toEqual([
    "get_provider_credential",
    "set_provider_credential",
  ])
})
