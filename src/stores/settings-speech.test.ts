import { beforeEach, expect, it, vi } from "vitest"

const disk = vi.hoisted(() => new Map<string, unknown>())
const invoke = vi.hoisted(() => vi.fn().mockImplementation(async (command: string) => command === "get_default_stt_provider" ? "whisper" : null))
vi.mock("@tauri-apps/api/core", () => ({ invoke }))
vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn() }))
vi.mock("@tauri-apps/plugin-store", () => ({
  load: async () => ({
    get: async (key: string) => disk.get(key),
    set: async (key: string, value: unknown) => disk.set(key, value),
    save: async () => {},
  }),
}))
beforeEach(() => { disk.clear(); vi.resetModules(); invoke.mockClear() })

it("defaults a fresh Mac install to the native offline provider", async () => {
  const { hydrateSettings, useSettingsStore } = await import("./settings-store")
  await hydrateSettings()
  expect(useSettingsStore.getState().sttProvider).toBe("whisper")
  expect(useSettingsStore.getState().settingsHydrated).toBe(true)
})

it.each(["deepgram", "assemblyai", "whisper"])("keeps a saved %s choice", async (provider) => {
  disk.set("sttProvider", provider)
  const { hydrateSettings, useSettingsStore } = await import("./settings-store")
  await hydrateSettings()
  expect(useSettingsStore.getState().sttProvider).toBe(provider)
  expect(invoke).not.toHaveBeenCalledWith("get_default_stt_provider")
})

it("keeps the previous implicit provider for an existing completed setup", async () => {
  disk.set("onboardingComplete", true)
  const { hydrateSettings, useSettingsStore } = await import("./settings-store")
  await hydrateSettings()
  expect(useSettingsStore.getState().sttProvider).toBe("deepgram")
  expect(invoke).not.toHaveBeenCalledWith("get_default_stt_provider")
})
