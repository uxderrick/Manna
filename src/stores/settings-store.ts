import { create } from "zustand"
import { load, type Store } from "@tauri-apps/plugin-store"
import { emit } from "@tauri-apps/api/event"
import {
  type CalibrationInsets,
  IDENTITY_INSETS,
} from "@/lib/projector-calibration"
import { DEFAULT_HIGHLIGHT_COLOR, normalizeHighlightColor } from "@/lib/text-highlights"

type SttProvider = "deepgram" | "whisper" | "assemblyai"

export interface BrandConfig {
  churchName: string | null
  logoPath: string | null        // app/sessions logo
  blankImagePath: string | null  // projector blank-slide image
  momoImagePath: string | null
  jesusImagePath: string | null
}

const DEFAULT_BRAND: BrandConfig = {
  churchName: null,
  logoPath: null,
  blankImagePath: null,
  momoImagePath: null,
  jesusImagePath: null,
}

interface SettingsState {
  deepgramApiKey: string | null
  assemblyAiApiKey: string | null
  claudeApiKey: string | null
  deepseekApiKey: string | null
  geniusToken: string | null
  pexelsApiKey: string | null
  unsplashApiKey: string | null
  braveApiKey: string | null
  localImageFolder: string | null
  activeTranslationId: number
  audioDeviceId: string | null
  gain: number
  autoMode: boolean
  confidenceThreshold: number
  cooldownMs: number
  autoSplitLongVerses: boolean
  splitWordThreshold: number
  defaultHighlightColor: string
  onboardingComplete: boolean
  sttProvider: SttProvider
  enabledHymnals: string[]
  recordAudio: boolean
  projectorCalibration: CalibrationInsets
  brand: BrandConfig

  setDeepgramApiKey: (key: string | null) => void
  setAssemblyAiApiKey: (key: string | null) => void
  setClaudeApiKey: (key: string | null) => void
  setDeepseekApiKey: (key: string | null) => void
  setGeniusToken: (token: string | null) => void
  setPexelsApiKey: (key: string | null) => void
  setUnsplashApiKey: (key: string | null) => void
  setBraveApiKey: (key: string | null) => void
  setLocalImageFolder: (path: string | null) => void
  setActiveTranslationId: (id: number) => void
  setAudioDeviceId: (id: string | null) => void
  setGain: (gain: number) => void
  setAutoMode: (auto: boolean) => void
  setConfidenceThreshold: (threshold: number) => void
  setCooldownMs: (ms: number) => void
  setAutoSplitLongVerses: (v: boolean) => void
  setSplitWordThreshold: (n: number) => void
  setDefaultHighlightColor: (color: string) => void
  setOnboardingComplete: (complete: boolean) => void
  setSttProvider: (provider: SttProvider) => void
  setEnabledHymnals: (ids: string[]) => void
  setRecordAudio: (v: boolean) => void
  setProjectorCalibration: (insets: CalibrationInsets) => void
  setBrand: (brand: BrandConfig) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  deepgramApiKey: null,
  assemblyAiApiKey: null,
  claudeApiKey: null,
  deepseekApiKey: null,
  geniusToken: null,
  pexelsApiKey: null,
  unsplashApiKey: null,
  braveApiKey: null,
  localImageFolder: null,
  activeTranslationId: 1,
  audioDeviceId: null,
  gain: 1.0,
  autoMode: false,
  confidenceThreshold: 0.8,
  cooldownMs: 2500,
  autoSplitLongVerses: true,
  splitWordThreshold: 40,
  defaultHighlightColor: DEFAULT_HIGHLIGHT_COLOR,
  onboardingComplete: false,
  sttProvider: "deepgram",
  enabledHymnals: ["ghs", "mhb", "sankey", "sda"],
  recordAudio: true,
  projectorCalibration: IDENTITY_INSETS,
  brand: DEFAULT_BRAND,

  setDeepgramApiKey: (deepgramApiKey) => set({ deepgramApiKey }),
  setAssemblyAiApiKey: (assemblyAiApiKey) => set({ assemblyAiApiKey }),
  setClaudeApiKey: (claudeApiKey) => set({ claudeApiKey }),
  setDeepseekApiKey: (deepseekApiKey) => set({ deepseekApiKey }),
  setGeniusToken: (geniusToken) => set({ geniusToken }),
  setPexelsApiKey: (pexelsApiKey) => set({ pexelsApiKey }),
  setUnsplashApiKey: (unsplashApiKey) => set({ unsplashApiKey }),
  setBraveApiKey: (braveApiKey) => set({ braveApiKey }),
  setLocalImageFolder: (localImageFolder) => set({ localImageFolder }),
  setActiveTranslationId: (activeTranslationId) => set({ activeTranslationId }),
  setAudioDeviceId: (audioDeviceId) => set({ audioDeviceId }),
  setGain: (gain) => set({ gain }),
  setAutoMode: (autoMode) => set({ autoMode }),
  setConfidenceThreshold: (confidenceThreshold) => set({ confidenceThreshold }),
  setCooldownMs: (cooldownMs) => set({ cooldownMs }),
  setAutoSplitLongVerses: (autoSplitLongVerses) => set({ autoSplitLongVerses }),
  setSplitWordThreshold: (splitWordThreshold) => set({ splitWordThreshold }),
  setDefaultHighlightColor: (defaultHighlightColor) => set({ defaultHighlightColor }),
  setOnboardingComplete: (onboardingComplete) => set({ onboardingComplete }),
  setSttProvider: (sttProvider) => set({ sttProvider }),
  setEnabledHymnals: (enabledHymnals) => set({ enabledHymnals }),
  setRecordAudio: (recordAudio) => set({ recordAudio }),
  setProjectorCalibration: (projectorCalibration) => set({ projectorCalibration }),
  setBrand: (brand) => set({ brand }),
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
      deepseekApiKey,
      geniusToken,
      pexelsApiKey,
      unsplashApiKey,
      braveApiKey,
      localImageFolder,
      sttProvider,
      onboardingComplete,
      gain,
      audioDeviceId,
      autoMode,
      confidenceThreshold,
      cooldownMs,
      enabledHymnals,
      recordAudio,
      projectorCalibration,
      brand,
      autoSplitLongVerses,
      splitWordThreshold,
      defaultHighlightColor,
    ] = await Promise.all([
      store.get<string>("deepgramApiKey"),
      store.get<string>("assemblyAiApiKey"),
      store.get<string>("claudeApiKey"),
      store.get<string>("deepseekApiKey"),
      store.get<string>("geniusToken"),
      store.get<string>("pexelsApiKey"),
      store.get<string>("unsplashApiKey"),
      store.get<string>("braveApiKey"),
      store.get<string>("localImageFolder"),
      store.get<SttProvider>("sttProvider"),
      store.get<boolean>("onboardingComplete"),
      store.get<number>("gain"),
      store.get<string>("audioDeviceId"),
      store.get<boolean>("autoMode"),
      store.get<number>("confidenceThreshold"),
      store.get<number>("cooldownMs"),
      store.get<string[]>("enabledHymnals"),
      store.get<boolean>("recordAudio"),
      store.get<CalibrationInsets>("projectorCalibration"),
      store.get<BrandConfig>("brand"),
      store.get<boolean>("autoSplitLongVerses"),
      store.get<number>("splitWordThreshold"),
      store.get<string>("defaultHighlightColor"),
    ])

    const s = useSettingsStore.getState()
    if (deepgramApiKey) s.setDeepgramApiKey(deepgramApiKey)
    if (assemblyAiApiKey) s.setAssemblyAiApiKey(assemblyAiApiKey)
    if (claudeApiKey) s.setClaudeApiKey(claudeApiKey)
    if (deepseekApiKey) s.setDeepseekApiKey(deepseekApiKey)
    if (geniusToken) s.setGeniusToken(geniusToken)
    if (pexelsApiKey) s.setPexelsApiKey(pexelsApiKey)
    if (unsplashApiKey) s.setUnsplashApiKey(unsplashApiKey)
    if (braveApiKey) s.setBraveApiKey(braveApiKey)
    if (localImageFolder) s.setLocalImageFolder(localImageFolder)
    if (sttProvider) s.setSttProvider(sttProvider)
    if (onboardingComplete) s.setOnboardingComplete(true)
    if (gain != null) s.setGain(gain)
    if (audioDeviceId) s.setAudioDeviceId(audioDeviceId)
    if (autoMode != null) s.setAutoMode(autoMode)
    if (confidenceThreshold != null) s.setConfidenceThreshold(confidenceThreshold)
    if (cooldownMs != null) s.setCooldownMs(cooldownMs)
    if (Array.isArray(enabledHymnals) && enabledHymnals.length > 0) {
      s.setEnabledHymnals(enabledHymnals)
    }
    if (typeof recordAudio === "boolean") useSettingsStore.setState({ recordAudio })
    if (
      projectorCalibration &&
      typeof projectorCalibration === "object" &&
      typeof projectorCalibration.top === "number"
    ) {
      s.setProjectorCalibration(projectorCalibration)
    }
    if (brand && typeof brand === "object") {
      s.setBrand({
        churchName: typeof brand.churchName === "string" ? brand.churchName : null,
        logoPath: typeof brand.logoPath === "string" ? brand.logoPath : null,
        blankImagePath: typeof brand.blankImagePath === "string" ? brand.blankImagePath : null,
        momoImagePath: typeof brand.momoImagePath === "string" ? brand.momoImagePath : null,
        jesusImagePath: typeof brand.jesusImagePath === "string" ? brand.jesusImagePath : null,
      })
    }
    if (autoSplitLongVerses != null) s.setAutoSplitLongVerses(autoSplitLongVerses)
    if (splitWordThreshold != null) {
      const clamped = Math.max(20, Math.min(200, Math.round(splitWordThreshold)))
      s.setSplitWordThreshold(clamped)
    }
    if (defaultHighlightColor) s.setDefaultHighlightColor(normalizeHighlightColor(defaultHighlightColor))
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

/** Persist the DeepSeek API key to disk. */
export async function persistDeepseekApiKey(key: string | null): Promise<void> {
  useSettingsStore.getState().setDeepseekApiKey(key)
  try {
    const store = await getStore()
    if (key) {
      await store.set("deepseekApiKey", key)
    } else {
      await store.delete("deepseekApiKey")
    }
  } catch {
    console.warn("[settings] Failed to persist DeepSeek API key")
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

/** Persist Pexels API key to disk. */
export async function persistPexelsApiKey(key: string | null): Promise<void> {
  useSettingsStore.getState().setPexelsApiKey(key)
  try {
    const store = await getStore()
    if (key) await store.set("pexelsApiKey", key)
    else await store.delete("pexelsApiKey")
  } catch {
    console.warn("[settings] Failed to persist Pexels API key")
  }
}

/** Persist Unsplash API key to disk. */
export async function persistUnsplashApiKey(key: string | null): Promise<void> {
  useSettingsStore.getState().setUnsplashApiKey(key)
  try {
    const store = await getStore()
    if (key) await store.set("unsplashApiKey", key)
    else await store.delete("unsplashApiKey")
  } catch {
    console.warn("[settings] Failed to persist Unsplash API key")
  }
}

/** Persist Brave Search API key to disk. */
export async function persistBraveApiKey(key: string | null): Promise<void> {
  useSettingsStore.getState().setBraveApiKey(key)
  try {
    const store = await getStore()
    if (key) await store.set("braveApiKey", key)
    else await store.delete("braveApiKey")
  } catch {
    console.warn("[settings] Failed to persist Brave API key")
  }
}

/** Persist local image folder path to disk. */
export async function persistLocalImageFolder(path: string | null): Promise<void> {
  useSettingsStore.getState().setLocalImageFolder(path)
  try {
    const store = await getStore()
    if (path) await store.set("localImageFolder", path)
    else await store.delete("localImageFolder")
  } catch {
    console.warn("[settings] Failed to persist local image folder")
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

/** Persist the auto-split-long-verses toggle to disk. */
export async function persistAutoSplitLongVerses(v: boolean): Promise<void> {
  useSettingsStore.getState().setAutoSplitLongVerses(v)
  try {
    const store = await getStore()
    await store.set("autoSplitLongVerses", v)
  } catch {
    console.warn("[settings] Failed to persist autoSplitLongVerses")
  }
}

/** Persist the long-verse word threshold to disk. Clamps to [20, 200]. */
export async function persistSplitWordThreshold(n: number): Promise<void> {
  const clamped = Math.max(20, Math.min(200, Math.round(n)))
  useSettingsStore.getState().setSplitWordThreshold(clamped)
  try {
    const store = await getStore()
    await store.set("splitWordThreshold", clamped)
  } catch {
    console.warn("[settings] Failed to persist splitWordThreshold")
  }
}

export async function persistDefaultHighlightColor(color: string): Promise<void> {
  const normalized = normalizeHighlightColor(color)
  useSettingsStore.getState().setDefaultHighlightColor(normalized)
  try {
    const store = await getStore()
    await store.set("defaultHighlightColor", normalized)
  } catch {
    console.warn("[settings] Failed to persist defaultHighlightColor")
  }
}

/** Persist detection cooldown (ms) to disk. */
export async function persistCooldownMs(ms: number): Promise<void> {
  useSettingsStore.getState().setCooldownMs(ms)
  try {
    const store = await getStore()
    await store.set("cooldownMs", ms)
  } catch {
    console.warn("[settings] Failed to persist cooldownMs")
  }
}

/** Persist enabled hymnals list to disk. */
export async function persistEnabledHymnals(ids: string[]): Promise<void> {
  useSettingsStore.getState().setEnabledHymnals(ids)
  try {
    const store = await getStore()
    await store.set("enabledHymnals", ids)
  } catch {
    console.warn("[settings] Failed to persist enabledHymnals")
  }
}

/** Persist record audio toggle to disk. */
export async function persistRecordAudio(value: boolean): Promise<void> {
  useSettingsStore.getState().setRecordAudio(value)
  try {
    const store = await getStore()
    await store.set("recordAudio", value)
  } catch {
    console.warn("[settings] Failed to persist recordAudio")
  }
}

/** Persist projector calibration AND push it to the projector webview so the
 *  output updates live. `editing` drives the on-projector calibration overlay. */
export async function persistProjectorCalibration(
  insets: CalibrationInsets,
  editing: boolean,
): Promise<void> {
  useSettingsStore.getState().setProjectorCalibration(insets)
  void emit("projector:calibration", { insets, editing }).catch(() => {})
  try {
    const store = await getStore()
    await store.set("projectorCalibration", insets)
    await store.save()
  } catch {
    console.warn("[settings] Failed to persist projectorCalibration")
  }
}

/** Persist a brand-config patch (merged over current) to disk. */
export async function persistBrandConfig(patch: Partial<BrandConfig>): Promise<void> {
  const next = { ...useSettingsStore.getState().brand, ...patch }
  useSettingsStore.getState().setBrand(next)
  try {
    const store = await getStore()
    await store.set("brand", next)
    await store.save()
  } catch {
    console.warn("[settings] Failed to persist brand config")
  }
}

export type { SttProvider }
