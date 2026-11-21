import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { BUILTIN_THEMES } from "@/lib/builtin-themes"

const { invoke, emit } = vi.hoisted(() => ({ invoke: vi.fn(), emit: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  convertFileSrc: (path: string) => path,
}))
vi.mock("@tauri-apps/api/event", () => ({ emit }))

beforeEach(() => {
  vi.resetModules()
  invoke.mockReset().mockResolvedValue([])
  emit.mockReset().mockResolvedValue(undefined)
  const storage = new Map<string, string>()
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  })
})
afterEach(() => vi.unstubAllGlobals())

it("keeps the selected themes through Bible/Songs navigation and app state reload", async () => {
  const { useBroadcastStore: store } = await import("./broadcast-store")
  const { usePanelTabsStore } = await import("./panel-tabs-store")
  store.getState().setActiveTheme("builtin-the-word")
  store.getState().setAltActiveTheme("builtin-quiet-light")
  usePanelTabsStore.getState().setTab("left", "songs")
  usePanelTabsStore.getState().setTab("left", "search")
  expect(store.getState().activeThemeId).toBe("builtin-the-word")
  vi.resetModules()
  const { useBroadcastStore: restored } = await import("./broadcast-store")
  expect(restored.getState().activeThemeId).toBe("builtin-the-word")
  expect(restored.getState().altActiveThemeId).toBe("builtin-quiet-light")
})

it("restores a selected custom theme after its saved definition loads", async () => {
  const custom = {
    ...structuredClone(BUILTIN_THEMES[0]),
    id: "custom-service",
    name: "Service",
    builtin: false,
  }
  const { useBroadcastStore: store } = await import("./broadcast-store")
  await store.getState().saveTheme(custom)
  store.getState().setActiveTheme(custom.id)
  vi.resetModules()
  invoke.mockResolvedValueOnce([
    [custom.id, custom.name, JSON.stringify(custom)],
  ])
  const { useBroadcastStore: restored, hydrateCustomThemes } =
    await import("./broadcast-store")
  await hydrateCustomThemes()
  expect(restored.getState().activeThemeId).toBe(custom.id)
  expect(
    restored.getState().themes.find((theme) => theme.id === custom.id)?.name
  ).toBe("Service")
  restored.getState().loadThemes()
  expect(
    restored.getState().themes.some((theme) => theme.id === custom.id)
  ).toBe(true)
})

it("falls back safely when a saved theme no longer exists", async () => {
  localStorage.setItem(
    "manna-active-themes",
    JSON.stringify({ main: "deleted-theme", alt: "builtin-quiet-light" })
  )
  const { useBroadcastStore: store, hydrateCustomThemes } =
    await import("./broadcast-store")
  await hydrateCustomThemes()
  expect(store.getState().activeThemeId).toBe(BUILTIN_THEMES[0].id)
  expect(store.getState().altActiveThemeId).toBe("builtin-quiet-light")
})

it("preserves a new selection made while custom themes are loading", async () => {
  let finish!: (rows: Array<[string, string, string]>) => void
  invoke.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    })
  )
  const { useBroadcastStore: store, hydrateCustomThemes } =
    await import("./broadcast-store")
  const loading = hydrateCustomThemes()
  store.getState().setActiveTheme("builtin-the-word")
  finish([])
  await loading
  expect(store.getState().activeThemeId).toBe("builtin-the-word")
})
