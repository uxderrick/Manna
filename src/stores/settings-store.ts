import { create } from "zustand"
import { load, type Store } from "@tauri-apps/plugin-store"

type SttProvider = "deepgram" | "whisper" | "assemblyai"

interface SettingsState {
  deepgramApiKey: string | null
  assemblyAiApiKey: string | null
  openaiApiKey: string | null
  claudeApiKey: string | null
  geniusToken: string | null
  activeTranslationId: number
  audioDeviceId: string | null
  gain: number
  autoMode: boolean
  confidenceThreshold: number
  cooldownMs: number
  onboardingComplete: boolean
  sttProvider: SttProvider

  setDeepgramApiKey: (key: string | null) => void
  setAssemblyAiApiKey: (key: string | null) => void
  setOpenaiApiKey: (key: string | null) => void
  setClaudeApiKey: (key: string | null) => void
  setGeniusToken: (token: string | null) => void
  setActiveTranslationId: (id: number) => void
  setAudioDeviceId: (id: string | null) => void
  setGain: (gain: number) => void
  setAutoMode: (auto: boolean) => void
  setConfidenceThreshold: (threshold: number) => void
  setCooldownMs: (ms: number) => void
  setOnboardingComplete: (complete: boolean) => void
  setSttProvider: (provider: SttProvider) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  deepgramApiKey: null,
  assemblyAiApiKey: null,
  openaiApiKey: null,
  claudeApiKey: null,
  geniusToken: null,
  activeTranslationId: 1,
  audioDeviceId: null,
  gain: 1.0,
  autoMode: false,
  confidenceThreshold: 0.8,
  cooldownMs: 2500,
  onboardingComplete: false,
  sttProvider: "deepgram",

  setDeepgramApiKey: (deepgramApiKey) => set({ deepgramApiKey }),
  setAssemblyAiApiKey: (assemblyAiApiKey) => set({ assemblyAiApiKey }),
  setOpenaiApiKey: (openaiApiKey) => set({ openaiApiKey }),
  setClaudeApiKey: (claudeApiKey) => set({ claudeApiKey }),
  setGeniusToken: (geniusToken) => set({ geniusToken }),
  setActiveTranslationId: (activeTranslationId) => set({ activeTranslationId }),
  setAudioDeviceId: (audioDeviceId) => set({ audioDeviceId }),
  setGain: (gain) => set({ gain }),
  setAutoMode: (autoMode) => set({ autoMode }),
  setConfidenceThreshold: (confidenceThreshold) => set({ confidenceThreshold }),
  setCooldownMs: (cooldownMs) => set({ cooldownMs }),
  setOnboardingComplete: (onboardingComplete) => set({ onboardingComplete }),
  setSttProvider: (sttProvider) => set({ sttProvider }),
}))

// ── Shared Tauri store instance ────────────────────────────────────────
// Single instance with autoSave (100ms debounce) avoids race conditions
// from concurrent load()/save() calls across different persist functions.
let _store: Store | null = null
async function getStore(): Promise<Store> {
  if (!_store) {
    _store = await load("settings.json")
  }
  return _store
}

/** Load persisted settings from disk into the Zustand store. */
export async function hydrateSettings(): Promise<void> {
  try {
    const store = await getStore()
    const [
      deepgramApiKey,
      assemblyAiApiKey,
      claudeApiKey,
      geniusToken,
      sttProvider,
      onboardingComplete,
      gain,
      audioDeviceId,
      autoMode,
      confidenceThreshold,
    ] = await Promise.all([
      store.get<string>("deepgramApiKey"),
      store.get<string>("assemblyAiApiKey"),
      store.get<string>("claudeApiKey"),
      store.get<string>("geniusToken"),
      store.get<SttProvider>("sttProvider"),
      store.get<boolean>("onboardingComplete"),
      store.get<number>("gain"),
      store.get<string>("audioDeviceId"),
      store.get<boolean>("autoMode"),
      store.get<number>("confidenceThreshold"),
    ])

    const s = useSettingsStore.getState()
    if (deepgramApiKey) s.setDeepgramApiKey(deepgramApiKey)
    if (assemblyAiApiKey) s.setAssemblyAiApiKey(assemblyAiApiKey)
    if (claudeApiKey) s.setClaudeApiKey(claudeApiKey)
    if (geniusToken) s.setGeniusToken(geniusToken)
    if (sttProvider) s.setSttProvider(sttProvider)
    if (onboardingComplete) s.setOnboardingComplete(true)
    if (gain != null) s.setGain(gain)
    if (audioDeviceId) s.setAudioDeviceId(audioDeviceId)
    if (autoMode != null) s.setAutoMode(autoMode)
    if (confidenceThreshold != null) s.setConfidenceThreshold(confidenceThreshold)
  } catch {
    console.warn("[settings] Failed to load persisted settings, using defaults")
  }
}

/** Persist onboarding state to disk. */
export async function persistOnboardingComplete(): Promise<void> {
  useSettingsStore.getState().setOnboardingComplete(true)
  try {
    const store = await getStore()
    await store.set("onboardingComplete", true)
  } catch {
    console.warn("[settings] Failed to persist onboarding state")
  }
}

/** Persist gain to disk (debounced to avoid rapid writes from slider). */
let gainDebounceTimer: ReturnType<typeof setTimeout> | null = null
export function persistGain(gain: number): void {
  useSettingsStore.getState().setGain(gain)
  if (gainDebounceTimer) clearTimeout(gainDebounceTimer)
  gainDebounceTimer = setTimeout(async () => {
    try {
      const store = await getStore()
      await store.set("gain", gain)
    } catch {
      console.warn("[settings] Failed to persist gain")
    }
  }, 500)
}

/** Persist audio device ID to disk. */
export async function persistAudioDeviceId(deviceId: string | null): Promise<void> {
  useSettingsStore.getState().setAudioDeviceId(deviceId)
  try {
    const store = await getStore()
    if (deviceId) {
      await store.set("audioDeviceId", deviceId)
    } else {
      await store.delete("audioDeviceId")
    }
  } catch {
    console.warn("[settings] Failed to persist audio device ID")
  }
}

/** Persist the Deepgram API key to disk. */
export async function persistDeepgramApiKey(key: string | null): Promise<void> {
  useSettingsStore.getState().setDeepgramApiKey(key)
  try {
    const store = await getStore()
    if (key) {
      await store.set("deepgramApiKey", key)
    } else {
      await store.delete("deepgramApiKey")
    }
  } catch {
    console.warn("[settings] Failed to persist Deepgram API key")
  }
}

/** Persist the AssemblyAI API key to disk. */
export async function persistAssemblyAiApiKey(key: string | null): Promise<void> {
  useSettingsStore.getState().setAssemblyAiApiKey(key)
  try {
    const store = await getStore()
    if (key) {
      await store.set("assemblyAiApiKey", key)
    } else {
      await store.delete("assemblyAiApiKey")
    }
  } catch {
    console.warn("[settings] Failed to persist AssemblyAI API key")
  }
}

/** Persist the Claude API key to disk. */
export async function persistClaudeApiKey(key: string | null): Promise<void> {
  useSettingsStore.getState().setClaudeApiKey(key)
  try {
    const store = await getStore()
    if (key) {
      await store.set("claudeApiKey", key)
    } else {
      await store.delete("claudeApiKey")
    }
  } catch {
    console.warn("[settings] Failed to persist Claude API key")
  }
}

/** Persist the Genius API token to disk. */
export async function persistGeniusToken(token: string | null): Promise<void> {
  useSettingsStore.getState().setGeniusToken(token)
  try {
    const store = await getStore()
    if (token) {
      await store.set("geniusToken", token)
    } else {
      await store.delete("geniusToken")
    }
  } catch {
    console.warn("[settings] Failed to persist Genius token")
  }
}

/** Persist STT provider to disk. */
export async function persistSttProvider(provider: SttProvider): Promise<void> {
  useSettingsStore.getState().setSttProvider(provider)
  try {
    const store = await getStore()
    await store.set("sttProvider", provider)
  } catch {
    console.warn("[settings] Failed to persist STT provider")
  }
}

/** Persist auto broadcast mode to disk. */
export async function persistAutoMode(autoMode: boolean): Promise<void> {
  useSettingsStore.getState().setAutoMode(autoMode)
  try {
    const store = await getStore()
    await store.set("autoMode", autoMode)
  } catch {
    console.warn("[settings] Failed to persist auto mode")
  }
}

/** Persist confidence threshold to disk. */
export async function persistConfidenceThreshold(threshold: number): Promise<void> {
  useSettingsStore.getState().setConfidenceThreshold(threshold)
  try {
    const store = await getStore()
    await store.set("confidenceThreshold", threshold)
  } catch {
    console.warn("[settings] Failed to persist confidence threshold")
  }
}

export type { SttProvider }
