import { create } from "zustand"
import { load } from "@tauri-apps/plugin-store"

type SttProvider = "deepgram" | "whisper"

interface SettingsState {
  deepgramApiKey: string | null
  openaiApiKey: string | null
  claudeApiKey: string | null
  activeTranslationId: number
  audioDeviceId: string | null
  gain: number
  autoMode: boolean
  confidenceThreshold: number
  cooldownMs: number
  onboardingComplete: boolean
  sttProvider: SttProvider

  setDeepgramApiKey: (key: string | null) => void
  setOpenaiApiKey: (key: string | null) => void
  setClaudeApiKey: (key: string | null) => void
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
  openaiApiKey: null,
  claudeApiKey: null,
  activeTranslationId: 1,
  audioDeviceId: null,
  gain: 1.0,
  autoMode: false,
  confidenceThreshold: 0.8,
  cooldownMs: 2500,
  onboardingComplete: false,
  sttProvider: "deepgram",

  setDeepgramApiKey: (deepgramApiKey) => set({ deepgramApiKey }),
  setOpenaiApiKey: (openaiApiKey) => set({ openaiApiKey }),
  setClaudeApiKey: (claudeApiKey) => set({ claudeApiKey }),
  setActiveTranslationId: (activeTranslationId) => set({ activeTranslationId }),
  setAudioDeviceId: (audioDeviceId) => set({ audioDeviceId }),
  setGain: (gain) => set({ gain }),
  setAutoMode: (autoMode) => set({ autoMode }),
  setConfidenceThreshold: (confidenceThreshold) => set({ confidenceThreshold }),
  setCooldownMs: (cooldownMs) => set({ cooldownMs }),
  setOnboardingComplete: (onboardingComplete) => set({ onboardingComplete }),
  setSttProvider: (sttProvider) => set({ sttProvider }),
}))

/** Load persisted settings from disk into the Zustand store. */
export async function hydrateSettings(): Promise<void> {
  try {
    const store = await load("settings.json", { autoSave: false })
    const deepgramApiKey = await store.get<string>("deepgramApiKey")
    const sttProvider = await store.get<SttProvider>("sttProvider")
    const onboardingComplete = await store.get<boolean>("onboardingComplete")
    if (deepgramApiKey) {
      useSettingsStore.getState().setDeepgramApiKey(deepgramApiKey)
    }
    if (sttProvider) {
      useSettingsStore.getState().setSttProvider(sttProvider)
    }
    if (onboardingComplete) {
      useSettingsStore.getState().setOnboardingComplete(true)
    }
  } catch {
    console.warn("[settings] Failed to load persisted settings, using defaults")
  }
}

/** Persist onboarding state to disk. */
export async function persistOnboardingComplete(): Promise<void> {
  useSettingsStore.getState().setOnboardingComplete(true)
  try {
    const store = await load("settings.json", { autoSave: false })
    await store.set("onboardingComplete", true)
    await store.save()
  } catch {
    console.warn("[settings] Failed to persist onboarding state")
  }
}

/** Persist the Deepgram API key to disk. */
export async function persistDeepgramApiKey(key: string | null): Promise<void> {
  useSettingsStore.getState().setDeepgramApiKey(key)
  try {
    const store = await load("settings.json", { autoSave: false })
    if (key) {
      await store.set("deepgramApiKey", key)
    } else {
      await store.delete("deepgramApiKey")
    }
    await store.save()
  } catch {
    console.warn("[settings] Failed to persist Deepgram API key")
  }
}
