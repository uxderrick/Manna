import { invoke } from "@tauri-apps/api/core"
import type { Store } from "@tauri-apps/plugin-store"

export const CREDENTIAL_NAMES = [
  "deepgramApiKey",
  "assemblyAiApiKey",
  "claudeApiKey",
  "deepseekApiKey",
  "geniusToken",
  "pexelsApiKey",
  "unsplashApiKey",
  "braveApiKey",
] as const
export type CredentialName = (typeof CREDENTIAL_NAMES)[number]
type LegacyStore = Pick<Store, "get" | "delete" | "save">
const pending = new Map<CredentialName, Promise<unknown>>()
const loaded = new Map<CredentialName, string | null>()

// Migration and edits for one key must not overwrite each other.
function serial<T>(name: CredentialName, action: () => Promise<T>): Promise<T> {
  const next = (pending.get(name) ?? Promise.resolve())
    .catch(() => {})
    .then(action)
  pending.set(name, next)
  void next
    .finally(() => {
      if (pending.get(name) === next) pending.delete(name)
    })
    .catch(() => {})
  return next
}

async function removeLegacy(store: LegacyStore, name: CredentialName) {
  await store.delete(name)
  await store.save()
}

export function loadCredential(
  store: LegacyStore,
  name: CredentialName,
  warn: () => void
): Promise<string | null> {
  return serial(name, async () => {
    if (loaded.has(name)) return loaded.get(name)!
    const legacy = await store.get<unknown>(name)
    const fallback = typeof legacy === "string" && legacy ? legacy : null
    let usable = fallback
    try {
      const secure = await invoke<string | null>("get_provider_credential", {
        name,
      })
      if (secure !== null && typeof secure !== "string")
        throw new Error("Invalid secure storage response")
      if (secure) {
        usable = secure
        if (fallback) await removeLegacy(store, name)
        return secure
      }
      if (fallback) {
        // Native command verifies the saved value before we remove its old copy.
        await invoke("set_provider_credential", { name, value: fallback })
        await removeLegacy(store, name)
      }
      return fallback
    } catch {
      warn()
      return usable
    } finally {
      loaded.set(name, usable)
    }
  })
}

export function saveCredential(
  store: LegacyStore,
  name: CredentialName,
  value: string | null
): Promise<void> {
  return serial(name, async () => {
    await invoke("set_provider_credential", { name, value })
    loaded.set(name, value)
    await removeLegacy(store, name)
  })
}
