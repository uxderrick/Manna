import { useState, useEffect, useCallback, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Slider } from "@/components/ui/slider"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar"
import {
  MicIcon,
  TvIcon,
  KeyIcon,
  SettingsIcon,
  CheckIcon,
  BookOpenIcon,
  MusicIcon,
  RadioIcon,
  HelpCircleIcon,
  GraduationCapIcon,
  BrainCircuitIcon,
  Loader2Icon,
  HardDriveIcon,
  MonitorIcon,
  XIcon,
  PaletteIcon,
} from "lucide-react"
import { useSettingsStore, persistDeepgramApiKey, persistAssemblyAiApiKey, persistClaudeApiKey, persistDeepseekApiKey, persistGeniusToken, persistEnabledHymnals, persistAutoMode, persistConfidenceThreshold, persistSttProvider, persistPexelsApiKey, persistUnsplashApiKey, persistBraveApiKey, persistAutoSplitLongVerses, persistSplitWordThreshold } from "@/stores"
import { checkForUpdates } from "@/hooks/use-updater"
import { HYMNAL_NAMES, HYMNAL_SOURCES } from "@/types"
import { AudioTestPanel } from "@/components/audio-test-panel"
import { StoragePanel } from "@/components/panels/settings/storage"
import type { HymnalSource } from "@/types"
import { useTutorialStore } from "@/stores/tutorial-store"
import { useSettingsDialogStore } from "@/lib/settings-dialog"
import type { DeviceInfo } from "@/types/audio"
import { ProjectorCalibrationSection } from "@/components/settings/projector-calibration"
import { BrandingSection } from "@/components/settings/branding"
import { HighlightSettingsSection } from "@/components/settings/highlight-settings"

/* -------------------------------------------------------------------------- */
/*  Nav definition                                                            */
/* -------------------------------------------------------------------------- */

type NavSection = "audio" | "speech" | "bible" | "display" | "presentation" | "branding" | "hymnals" | "api-keys" | "remote" | "storage" | "projector" | "help"

type NavGroup = "Setup" | "Output" | "Integrations" | "Maintenance" | "Help"

const navItems: { name: string; id: NavSection; group: NavGroup; icon: React.ReactNode }[] = [
  {
    name: "Audio",
    id: "audio",
    group: "Setup",
    icon: <MicIcon strokeWidth={2} />,
  },
  {
    name: "Speech Recognition",
    id: "speech",
    group: "Setup",
    icon: <BrainCircuitIcon strokeWidth={2} />,
  },
  {
    name: "Bible",
    id: "bible",
    group: "Setup",
    icon: <BookOpenIcon strokeWidth={2} />,
  },
  {
    name: "Hymnals",
    id: "hymnals",
    group: "Setup",
    icon: <MusicIcon strokeWidth={2} />,
  },
  {
    name: "API Keys",
    id: "api-keys",
    group: "Setup",
    icon: <KeyIcon strokeWidth={2} />,
  },
  {
    name: "Display Mode",
    id: "display",
    group: "Output",
    icon: <TvIcon strokeWidth={2} />,
  },
  {
    name: "Branding",
    id: "branding",
    group: "Output",
    icon: <PaletteIcon strokeWidth={2} />,
  },
  {
    name: "Presentation",
    id: "presentation",
    group: "Output",
    icon: <PaletteIcon strokeWidth={2} />,
  },
  {
    name: "Projector",
    id: "projector",
    group: "Output",
    icon: <MonitorIcon strokeWidth={2} />,
  },
  {
    name: "Remote Control",
    id: "remote",
    group: "Integrations",
    icon: <RadioIcon strokeWidth={2} />,
  },
  {
    name: "Storage",
    id: "storage",
    group: "Maintenance",
    icon: <HardDriveIcon strokeWidth={2} />,
  },
  {
    name: "Help",
    id: "help",
    group: "Help",
    icon: <HelpCircleIcon strokeWidth={2} />,
  },
]

const navGroups: NavGroup[] = ["Setup", "Output", "Integrations", "Maintenance", "Help"]

/* -------------------------------------------------------------------------- */
/*  Section: Audio                                                            */
/* -------------------------------------------------------------------------- */

function AudioSection() {
  const {
    audioDeviceId,
    setAudioDeviceId,
    gain,
    setGain,
  } = useSettingsStore()

  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [loading, setLoading] = useState(true)

  const loadDevices = useCallback(async () => {
    try {
      setLoading(true)
      const result = await invoke<DeviceInfo[]>("get_audio_devices")
      setDevices(result)
    } catch {
      // Tauri command may not be available during dev
      setDevices([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadDevices()
  }, [loadDevices])

  // gain is 0.0-2.0 in store, display as 0-100%
  const gainPercent = Math.round((gain / 2.0) * 100)

  return (
    <div className="flex flex-col gap-6">
      {/* Device selector */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Input Device
        </label>
        <Select
          value={audioDeviceId ?? "__default__"}
          onValueChange={(v) => {
            import("@/stores/settings-store").then(({ persistAudioDeviceId }) => persistAudioDeviceId(v === "__default__" ? null : v))
          }}
          disabled={loading}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue
              placeholder={loading ? "Loading devices..." : "System default"}
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__default__">System default</SelectItem>
            {devices.map((device) => (
              <SelectItem key={device.id} value={device.id}>
                {device.name}
                {device.is_default ? " (default)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[0.625rem] text-muted-foreground">
          Selected device persists across sessions. Leave as system default to
          follow OS audio routing.
        </p>
        <div className="rounded-md bg-muted/50 px-3 py-2 text-[0.625rem] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground/70">Tip:</span> To capture audio from a soundboard, video, or another app, use a virtual audio device like{" "}
          <span className="font-medium">BlackHole</span> (free). Set up a Multi-Output Device in macOS Audio MIDI Setup to hear audio and route it to Manna simultaneously.
        </div>
      </div>

      {/* Input gain */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Input Gain
          </label>
          <span className="text-xs tabular-nums text-muted-foreground">
            {gainPercent}%
          </span>
        </div>
        <Slider
          min={0}
          max={100}
          step={1}
          value={[gainPercent]}
          onValueChange={([v]) => {
            import("@/stores/settings-store").then(({ persistGain }) => persistGain((v / 100) * 2.0))
          }}
        />
        <p className="text-[0.625rem] text-muted-foreground">
          Amplifies the incoming audio signal before transcription. 50% is unity
          gain.
        </p>
      </div>

      {/* Live mic test — reads the real cpal stream, not WebKit getUserMedia */}
      <AudioTestPanel deviceId={audioDeviceId} gain={gain} />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Section: Speech Recognition                                               */
/* -------------------------------------------------------------------------- */

type VerifyState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "ok"; detail: string }
  | { status: "fail"; detail: string }

type VerifyResult = { ok: boolean; http_ok: boolean; ws_ok: boolean; detail: string }

function SpeechSection() {
  const {
    sttProvider,
    deepgramApiKey,
    assemblyAiApiKey,
  } = useSettingsStore()
  const setActiveSection = useSettingsDialogStore((s) => s.setActiveSection)

  const selectedKeyStatus =
    sttProvider === "deepgram"
      ? { label: "Deepgram API Key", configured: Boolean(deepgramApiKey) }
      : sttProvider === "assemblyai"
        ? { label: "AssemblyAI API Key", configured: Boolean(assemblyAiApiKey) }
        : null

  return (
    <div className="flex flex-col gap-6">
      {/* Provider selector */}
      <div className="flex flex-col gap-3">
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Provider
        </label>

        <RadioGroup
          value={sttProvider}
          onValueChange={(v) => persistSttProvider(v as "deepgram" | "assemblyai" | "whisper")}
          className="gap-3"
        >
          {/* Deepgram (cloud) */}
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-data-[state=checked]:border-primary/50 has-data-[state=checked]:bg-primary/5 has-data-[state=checked]:ring-1 has-data-[state=checked]:ring-primary/20 ${
              sttProvider !== "deepgram" ? "hover:border-muted-foreground/25" : ""
            }`}
          >
            <RadioGroupItem value="deepgram" className="mt-0.5" />
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-foreground">
                Cloud (Deepgram)
              </span>
              <p className="text-[0.625rem] leading-relaxed text-muted-foreground">
                Uses Deepgram Nova-3 for real-time streaming transcription.
                Requires an API key and internet connection. Best accuracy with
                keyword boosting for Bible terms.
              </p>
            </div>
          </label>

          {/* AssemblyAI (cloud) */}
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-data-[state=checked]:border-primary/50 has-data-[state=checked]:bg-primary/5 has-data-[state=checked]:ring-1 has-data-[state=checked]:ring-primary/20 ${
              sttProvider !== "assemblyai" ? "hover:border-muted-foreground/25" : ""
            }`}
          >
            <RadioGroupItem value="assemblyai" className="mt-0.5" />
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-foreground">
                Cloud (AssemblyAI)
              </span>
              <p className="text-[0.625rem] leading-relaxed text-muted-foreground">
                Uses AssemblyAI Universal-Streaming. Cheaper than Deepgram
                ($0.15/hr), strong proper-noun accuracy via keyterms prompting.
                Requires an API key and internet connection.
              </p>
            </div>
          </label>

          {/* Whisper (local) */}
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-data-[state=checked]:border-primary/50 has-data-[state=checked]:bg-primary/5 has-data-[state=checked]:ring-1 has-data-[state=checked]:ring-primary/20 ${
              sttProvider !== "whisper" ? "hover:border-muted-foreground/25" : ""
            }`}
          >
            <RadioGroupItem value="whisper" className="mt-0.5" />
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-foreground">
                Local (Whisper)
              </span>
              <p className="text-[0.625rem] leading-relaxed text-muted-foreground">
                Runs Whisper large-v3-turbo locally on your device. Fully
                offline, no API key needed. Audio never leaves your machine.
              </p>
            </div>
          </label>
        </RadioGroup>
      </div>

      {selectedKeyStatus ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 p-3">
          <div className="flex items-center gap-2">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-foreground">
                {selectedKeyStatus.label}
              </span>
              <p className="text-[0.625rem] text-muted-foreground">
                Cloud transcription keys are managed in API Keys.
              </p>
            </div>
            {selectedKeyStatus.configured ? (
              <Badge variant="outline" className="text-[0.5rem]">
                Key configured
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[0.5rem] text-muted-foreground">
                Not set
              </Badge>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={() => setActiveSection("api-keys")}>
            Manage key
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <p className="text-xs font-medium text-foreground">No cloud key required</p>
          <p className="mt-1 text-[0.625rem] text-muted-foreground">
            Whisper runs locally. Use API Keys only for summaries, image search, or song lookup.
          </p>
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Section: Display Mode                                                     */
/* -------------------------------------------------------------------------- */

function DisplayModeSection() {
  const {
    autoMode,
    setAutoMode,
    confidenceThreshold,
    setConfidenceThreshold,
    autoSplitLongVerses,
    splitWordThreshold,
  } = useSettingsStore()

  const thresholdPercent = Math.round(confidenceThreshold * 100)

  return (
    <div className="flex flex-col gap-6">
      {/* Mode selector */}
      <div className="flex flex-col gap-3">
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Broadcast Mode
        </label>

        <RadioGroup
          value={autoMode ? "auto" : "manual"}
          onValueChange={(v) => persistAutoMode(v === "auto")}
          className="gap-3"
        >
          {/* Auto mode */}
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-data-[state=checked]:border-primary/50 has-data-[state=checked]:bg-primary/5 has-data-[state=checked]:ring-1 has-data-[state=checked]:ring-primary/20 ${
              !autoMode ? "hover:border-muted-foreground/25" : ""
            }`}
          >
            <RadioGroupItem value="auto" className="mt-0.5" />
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-foreground">Auto</span>
              <p className="text-[0.625rem] leading-relaxed text-muted-foreground">
                Automatically displays the highest-confidence detected verse on
                broadcast output. A 2.5-second cooldown prevents rapid flickering.
                Best for hands-off operation.
              </p>
            </div>
          </label>

          {/* Manual mode */}
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-data-[state=checked]:border-primary/50 has-data-[state=checked]:bg-primary/5 has-data-[state=checked]:ring-1 has-data-[state=checked]:ring-primary/20 ${
              autoMode ? "hover:border-muted-foreground/25" : ""
            }`}
          >
            <RadioGroupItem value="manual" className="mt-0.5" />
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-foreground">Manual</span>
              <p className="text-[0.625rem] leading-relaxed text-muted-foreground">
                Nothing goes to broadcast until you explicitly send it. Detected
                verses still appear in the AI Detections panel and queue, but you
                decide which ones to display and when. Best for important services.
              </p>
            </div>
          </label>
        </RadioGroup>
      </div>

      {/* Confidence threshold — only when auto */}
      {autoMode && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Confidence Threshold
            </label>
            <span className="text-xs tabular-nums text-muted-foreground">
              {thresholdPercent}%
            </span>
          </div>
          <Slider
            min={35}
            max={100}
            step={1}
            value={[thresholdPercent]}
            onValueChange={([v]) => persistConfidenceThreshold(v / 100)}
          />
          <p className="text-[0.625rem] text-muted-foreground">
            Only verses with confidence above this threshold will be sent to
            broadcast automatically. Higher values reduce false positives.
          </p>
        </div>
      )}

      {/* Long-verse auto-split */}
      <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <label className="text-xs font-medium text-foreground">
              Auto-split long verses
            </label>
            <p className="text-[0.625rem] text-muted-foreground">
              Long verses split into ~25-word chunks at sentence boundaries.
              Each chunk becomes its own queue row.
            </p>
          </div>
          <input
            type="checkbox"
            checked={autoSplitLongVerses}
            onChange={(e) => persistAutoSplitLongVerses(e.target.checked)}
            className="size-4 shrink-0 cursor-pointer"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[0.625rem] text-muted-foreground">
            Split if longer than
          </label>
          <Input
            type="number"
            min={20}
            max={200}
            value={splitWordThreshold}
            disabled={!autoSplitLongVerses}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (Number.isFinite(n)) persistSplitWordThreshold(n)
            }}
            className="h-7 w-16 text-xs"
          />
          <span className="text-[0.625rem] text-muted-foreground">words</span>
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Section: API Keys                                                         */
/* -------------------------------------------------------------------------- */

function ApiKeysSection() {
  const { deepgramApiKey, assemblyAiApiKey, deepseekApiKey, geniusToken, pexelsApiKey, unsplashApiKey, braveApiKey, sttProvider } = useSettingsStore()

  const [deepgramKeyValue, setDeepgramKeyValue] = useState(deepgramApiKey ?? "")
  const [deepgramSaved, setDeepgramSaved] = useState(false)
  const [deepgramVerify, setDeepgramVerify] = useState<VerifyState>({ status: "idle" })
  const [deepseekKeyValue, setDeepseekKeyValue] = useState(deepseekApiKey ?? "")
  const [deepseekSaved, setDeepseekSaved] = useState(false)
  const [deepseekVerify, setDeepseekVerify] = useState<VerifyState>({ status: "idle" })
  const [assemblyKeyValue, setAssemblyKeyValue] = useState(assemblyAiApiKey ?? "")
  const [assemblySaved, setAssemblySaved] = useState(false)
  const [assemblyVerify, setAssemblyVerify] = useState<VerifyState>({ status: "idle" })
  const [geniusValue, setGeniusValue] = useState(geniusToken ?? "")
  const [geniusSaved, setGeniusSaved] = useState(false)
  const [pexelsValue, setPexelsValue] = useState(pexelsApiKey ?? "")
  const [pexelsSaved, setPexelsSaved] = useState(false)
  const [unsplashValue, setUnsplashValue] = useState(unsplashApiKey ?? "")
  const [unsplashSaved, setUnsplashSaved] = useState(false)
  const [braveValue, setBraveValue] = useState(braveApiKey ?? "")
  const [braveSaved, setBraveSaved] = useState(false)

  const handleSaveDeepgramKey = () => {
    persistDeepgramApiKey(deepgramKeyValue || null)
    setDeepgramSaved(true)
    setTimeout(() => setDeepgramSaved(false), 2000)
  }

  const handleTestDeepgramKey = async () => {
    if (!deepgramKeyValue.trim()) {
      setDeepgramVerify({ status: "fail", detail: "Enter a key first." })
      return
    }
    setDeepgramVerify({ status: "testing" })
    try {
      const result = await invoke<VerifyResult>("verify_deepgram_key", {
        apiKey: deepgramKeyValue,
      })
      if (result.ok) {
        setDeepgramVerify({ status: "ok", detail: result.detail })
        if (deepgramKeyValue !== deepgramApiKey) persistDeepgramApiKey(deepgramKeyValue)
      } else {
        setDeepgramVerify({ status: "fail", detail: result.detail })
      }
    } catch (e) {
      setDeepgramVerify({ status: "fail", detail: String(e) })
    }
  }

  const handleSaveAssemblyKey = () => {
    persistAssemblyAiApiKey(assemblyKeyValue || null)
    setAssemblySaved(true)
    setTimeout(() => setAssemblySaved(false), 2000)
  }

  const handleTestAssemblyKey = async () => {
    if (!assemblyKeyValue.trim()) {
      setAssemblyVerify({ status: "fail", detail: "Enter a key first." })
      return
    }
    setAssemblyVerify({ status: "testing" })
    try {
      const result = await invoke<VerifyResult>("verify_assemblyai_key", {
        apiKey: assemblyKeyValue,
      })
      if (result.ok) {
        setAssemblyVerify({ status: "ok", detail: result.detail })
        if (assemblyKeyValue !== assemblyAiApiKey) persistAssemblyAiApiKey(assemblyKeyValue)
      } else {
        setAssemblyVerify({ status: "fail", detail: result.detail })
      }
    } catch (e) {
      setAssemblyVerify({ status: "fail", detail: String(e) })
    }
  }

  const handleSavePexels = () => {
    persistPexelsApiKey(pexelsValue || null)
    setPexelsSaved(true)
    setTimeout(() => setPexelsSaved(false), 2000)
  }
  const handleSaveUnsplash = () => {
    persistUnsplashApiKey(unsplashValue || null)
    setUnsplashSaved(true)
    setTimeout(() => setUnsplashSaved(false), 2000)
  }
  const handleSaveBrave = () => {
    persistBraveApiKey(braveValue || null)
    setBraveSaved(true)
    setTimeout(() => setBraveSaved(false), 2000)
  }

  const handleSaveDeepseekKey = () => {
    persistDeepseekApiKey(deepseekKeyValue || null)
    setDeepseekSaved(true)
    setTimeout(() => setDeepseekSaved(false), 2000)
  }

  const handleTestDeepseekKey = async () => {
    if (!deepseekKeyValue.trim()) {
      setDeepseekVerify({ status: "fail", detail: "Enter a key first." })
      return
    }
    setDeepseekVerify({ status: "testing" })
    try {
      const result = await invoke<VerifyResult>("verify_deepseek_key", {
        apiKey: deepseekKeyValue,
      })
      if (result.ok) {
        setDeepseekVerify({ status: "ok", detail: result.detail })
        if (deepseekKeyValue !== deepseekApiKey) persistDeepseekApiKey(deepseekKeyValue)
      } else {
        setDeepseekVerify({ status: "fail", detail: result.detail })
      }
    } catch (e) {
      setDeepseekVerify({ status: "fail", detail: String(e) })
    }
  }

  const handleSaveGeniusToken = () => {
    persistGeniusToken(geniusValue || null)
    setGeniusSaved(true)
    setTimeout(() => setGeniusSaved(false), 2000)
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Deepgram API Key */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Deepgram API Key
          </label>
          {deepgramApiKey ? (
            <Badge variant="outline" className="text-[0.5rem]">
              Key configured
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[0.5rem] text-muted-foreground">
              Not set
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Input
            type="password"
            placeholder="Enter your Deepgram API key..."
            value={deepgramKeyValue}
            onChange={(e) => {
              setDeepgramKeyValue(e.target.value)
              setDeepgramVerify({ status: "idle" })
            }}
            className="flex-1 text-xs"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={handleTestDeepgramKey}
            disabled={deepgramVerify.status === "testing"}
          >
            {deepgramVerify.status === "testing" ? (
              <>
                <Loader2Icon className="size-3 animate-spin" />
                Testing…
              </>
            ) : (
              "Test"
            )}
          </Button>
          <Button size="sm" onClick={handleSaveDeepgramKey}>
            {deepgramSaved ? (
              <>
                <CheckIcon className="size-3" />
                Saved
              </>
            ) : (
              "Save"
            )}
          </Button>
        </div>
        {deepgramVerify.status === "ok" && (
          <p className="flex items-center gap-1.5 text-[0.625rem] text-emerald-600 dark:text-emerald-400">
            <CheckIcon className="size-3" /> {deepgramVerify.detail}
          </p>
        )}
        {deepgramVerify.status === "fail" && (
          <p className="flex items-center gap-1.5 text-[0.625rem] text-destructive">
            <XIcon className="size-3" /> {deepgramVerify.detail}
          </p>
        )}
        <p className="text-[0.625rem] text-muted-foreground">
          {sttProvider === "whisper"
            ? "Not required when using local Whisper. "
            : "Required for cloud transcription. "}
          Get a key at <span className="text-primary">deepgram.com</span>.
        </p>
      </div>

      {/* AssemblyAI API Key */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            AssemblyAI API Key
          </label>
          {assemblyAiApiKey ? (
            <Badge variant="outline" className="text-[0.5rem]">
              Key configured
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[0.5rem] text-muted-foreground">
              Not set
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Input
            type="password"
            placeholder="Enter your AssemblyAI API key..."
            value={assemblyKeyValue}
            onChange={(e) => {
              setAssemblyKeyValue(e.target.value)
              setAssemblyVerify({ status: "idle" })
            }}
            className="flex-1 text-xs"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={handleTestAssemblyKey}
            disabled={assemblyVerify.status === "testing"}
          >
            {assemblyVerify.status === "testing" ? (
              <>
                <Loader2Icon className="size-3 animate-spin" />
                Testing…
              </>
            ) : (
              "Test"
            )}
          </Button>
          <Button size="sm" onClick={handleSaveAssemblyKey}>
            {assemblySaved ? (
              <>
                <CheckIcon className="size-3" />
                Saved
              </>
            ) : (
              "Save"
            )}
          </Button>
        </div>
        {assemblyVerify.status === "ok" && (
          <p className="flex items-center gap-1.5 text-[0.625rem] text-emerald-600 dark:text-emerald-400">
            <CheckIcon className="size-3" /> {assemblyVerify.detail}
          </p>
        )}
        {assemblyVerify.status === "fail" && (
          <p className="flex items-center gap-1.5 text-[0.625rem] text-destructive">
            <XIcon className="size-3" /> {assemblyVerify.detail}
          </p>
        )}
        {assemblyVerify.status === "idle" && (
          <p className="text-[0.625rem] text-muted-foreground">
            Required for live transcription when AssemblyAI is selected. Get a key at{" "}
            <span className="text-primary">assemblyai.com</span>
          </p>
        )}
      </div>

      {/* DeepSeek API Key */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            DeepSeek API Key
          </label>
          {deepseekApiKey ? (
            <Badge variant="outline" className="text-[0.5rem]">
              Key configured
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[0.5rem] text-muted-foreground">
              Not set
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Input
            type="password"
            placeholder="Enter your DeepSeek API key..."
            value={deepseekKeyValue}
            onChange={(e) => {
              setDeepseekKeyValue(e.target.value)
              setDeepseekVerify({ status: "idle" })
            }}
            className="flex-1 text-xs"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={handleTestDeepseekKey}
            disabled={deepseekVerify.status === "testing"}
          >
            {deepseekVerify.status === "testing" ? "Testing…" : "Test"}
          </Button>
          <Button size="sm" onClick={handleSaveDeepseekKey}>
            {deepseekSaved ? (
              <>
                <CheckIcon className="size-3" />
                Saved
              </>
            ) : (
              "Save"
            )}
          </Button>
        </div>
        {deepseekVerify.status === "ok" && (
          <p className="text-[0.625rem] text-emerald-500">{deepseekVerify.detail}</p>
        )}
        {deepseekVerify.status === "fail" && (
          <p className="text-[0.625rem] text-destructive">{deepseekVerify.detail}</p>
        )}
        <p className="text-[0.625rem] text-muted-foreground">
          Used for AI sermon summaries. Get a key at{" "}
          <span className="text-primary">platform.deepseek.com</span>
        </p>
      </div>

      {/* Genius API Token (song lookup) */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Genius API Token
          </label>
          {geniusToken ? (
            <Badge variant="outline" className="text-[0.5rem]">
              Token configured
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[0.5rem] text-muted-foreground">
              Not set
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Input
            type="password"
            placeholder="Paste Genius token..."
            value={geniusValue}
            onChange={(e) => setGeniusValue(e.target.value)}
            className="flex-1 text-xs"
          />
          <Button size="sm" onClick={handleSaveGeniusToken}>
            {geniusSaved ? (
              <>
                <CheckIcon className="size-3" />
                Saved
              </>
            ) : (
              "Save"
            )}
          </Button>
        </div>
        <p className="text-[0.625rem] text-muted-foreground">
          Optional — enables song lookup via Genius. Create a token at{" "}
          <span className="text-primary">genius.com/api-clients</span>
        </p>
      </div>

      {/* Pexels API Key */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Pexels API Key
          </label>
          {pexelsApiKey ? (
            <Badge variant="outline" className="text-[0.5rem]">Key configured</Badge>
          ) : (
            <Badge variant="outline" className="text-[0.5rem] text-muted-foreground">Not set</Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Input
            type="password"
            placeholder="Paste Pexels API key..."
            value={pexelsValue}
            onChange={(e) => setPexelsValue(e.target.value)}
            className="flex-1 text-xs"
          />
          <Button size="sm" onClick={handleSavePexels}>
            {pexelsSaved ? (<><CheckIcon className="size-3" />Saved</>) : "Save"}
          </Button>
        </div>
        <p className="text-[0.625rem] text-muted-foreground">
          Free image search. Sign up at <span className="text-primary">pexels.com/api</span>
        </p>
      </div>

      {/* Unsplash API Key */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Unsplash API Key
          </label>
          {unsplashApiKey ? (
            <Badge variant="outline" className="text-[0.5rem]">Key configured</Badge>
          ) : (
            <Badge variant="outline" className="text-[0.5rem] text-muted-foreground">Not set</Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Input
            type="password"
            placeholder="Paste Unsplash Access Key..."
            value={unsplashValue}
            onChange={(e) => setUnsplashValue(e.target.value)}
            className="flex-1 text-xs"
          />
          <Button size="sm" onClick={handleSaveUnsplash}>
            {unsplashSaved ? (<><CheckIcon className="size-3" />Saved</>) : "Save"}
          </Button>
        </div>
        <p className="text-[0.625rem] text-muted-foreground">
          Free image search. Sign up at <span className="text-primary">unsplash.com/developers</span>
        </p>
      </div>

      {/* Brave Search API Key */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Brave Search API Key
          </label>
          {braveApiKey ? (
            <Badge variant="outline" className="text-[0.5rem]">Key configured</Badge>
          ) : (
            <Badge variant="outline" className="text-[0.5rem] text-muted-foreground">Not set</Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Input
            type="password"
            placeholder="Paste Brave Subscription Token..."
            value={braveValue}
            onChange={(e) => setBraveValue(e.target.value)}
            className="flex-1 text-xs"
          />
          <Button size="sm" onClick={handleSaveBrave}>
            {braveSaved ? (<><CheckIcon className="size-3" />Saved</>) : "Save"}
          </Button>
        </div>
        <p className="text-[0.625rem] text-muted-foreground">
          Web-wide image results. 2,000 queries/mo free. Sign up at <span className="text-primary">brave.com/search/api</span>
        </p>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Section titles                                                            */
/* -------------------------------------------------------------------------- */

const sectionTitles: Record<NavSection, string> = {
  audio: "Audio",
  speech: "Speech Recognition",
  bible: "Bible Translation",
  display: "Display Mode",
  branding: "Branding",
  presentation: "Presentation",
  hymnals: "Hymnals",
  remote: "Remote Control",
  "api-keys": "API Keys",
  storage: "Storage",
  projector: "Projector",
  help: "Help",
}

/* -------------------------------------------------------------------------- */
/*  Section: Bible Translation                                                */
/* -------------------------------------------------------------------------- */

interface TranslationInfo {
  id: number
  abbreviation: string
  title: string
  language: string
}

function BibleSection() {
  const [translations, setTranslations] = useState<TranslationInfo[]>([])
  const [activeId, setActiveId] = useState<number>(1)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const [trans, active] = await Promise.all([
          invoke<TranslationInfo[]>("list_translations"),
          invoke<number>("get_active_translation"),
        ])
        setTranslations(trans)
        setActiveId(active)
      } catch (e) {
        console.error("Failed to load translations:", e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const handleChange = (value: string) => {
    const id = parseInt(value)
    setActiveId(id)
    void import("@/lib/switch-translation").then(({ switchTranslation }) => switchTranslation(id))
  }

  const englishTranslations = translations.filter((t) => t.language === "en")
  const otherTranslations = translations.filter((t) => t.language !== "en")

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Primary Translation
        </label>
        <Select
          value={String(activeId)}
          onValueChange={handleChange}
          disabled={loading}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder={loading ? "Loading..." : "Select translation"} />
          </SelectTrigger>
          <SelectContent>
            {englishTranslations.length > 0 && (
              <>
                <div className="px-2 py-1 text-[0.5625rem] font-medium uppercase tracking-wider text-muted-foreground">
                  English
                </div>
                {englishTranslations.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.abbreviation} — {t.title}
                  </SelectItem>
                ))}
              </>
            )}
            {otherTranslations.length > 0 && (
              <>
                <div className="mt-1 px-2 py-1 text-[0.5625rem] font-medium uppercase tracking-wider text-muted-foreground">
                  Other Languages
                </div>
                {otherTranslations.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.abbreviation} — {t.title}
                  </SelectItem>
                ))}
              </>
            )}
          </SelectContent>
        </Select>
        <p className="text-[0.625rem] text-muted-foreground">
          Detected verses will display in this translation.
          {translations.length > 0 && ` ${translations.length} translations available.`}
        </p>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Section: Remote Control                                                   */
/* -------------------------------------------------------------------------- */

interface RemoteStatus {
  running: boolean
  port: number | null
}

interface CommandLogEntry {
  id: number
  timestamp: string
  source: "OSC" | "HTTP"
  command: string
}

function RemoteControlSection() {
  const [oscEnabled, setOscEnabled] = useState(false)
  const [httpEnabled, setHttpEnabled] = useState(false)
  const [oscPort, setOscPort] = useState("8000")
  const [httpPort, setHttpPort] = useState("8080")
  const [oscStatus, setOscStatus] = useState<RemoteStatus>({ running: false, port: null })
  const [httpStatus, setHttpStatus] = useState<RemoteStatus>({ running: false, port: null })
  const [oscError, setOscError] = useState<string | null>(null)
  const [httpError, setHttpError] = useState<string | null>(null)
  const [commandLog, setCommandLog] = useState<CommandLogEntry[]>([])
  const logIdRef = useRef(0)

  // Poll statuses
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const osc = await invoke<RemoteStatus>("get_osc_status")
        setOscStatus(osc)
        if (osc.running) setOscError(null)
      } catch { /* ignore */ }
      try {
        const http = await invoke<RemoteStatus>("get_http_status")
        setHttpStatus(http)
        if (http.running) setHttpError(null)
      } catch { /* ignore */ }
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  // Listen for remote commands to populate the log
  useEffect(() => {
    let cancelled = false
    const unlisteners: (() => void)[] = []

    async function setup() {
      const { listen } = await import("@tauri-apps/api/event")

      const remoteEvents = [
        "remote:next", "remote:prev", "remote:theme", "remote:opacity",
        "remote:on_air", "remote:show", "remote:hide", "remote:confidence",
      ]

      for (const event of remoteEvents) {
        const unlisten = await listen(event, () => {
          if (cancelled) return
          const entry: CommandLogEntry = {
            id: logIdRef.current++,
            timestamp: new Date().toLocaleTimeString(),
            source: "OSC", // We can't distinguish source at event level; default to OSC
            command: event.replace("remote:", ""),
          }
          setCommandLog((prev) => [entry, ...prev].slice(0, 50))
        })
        unlisteners.push(unlisten)
      }
    }

    setup()
    return () => {
      cancelled = true
      unlisteners.forEach((fn) => fn())
    }
  }, [])

  const handleOscToggle = async () => {
    try {
      if (oscStatus.running) {
        await invoke("stop_osc")
        setOscEnabled(false)
        setOscError(null)
      } else {
        const port = parseInt(oscPort) || 8000
        const boundPort = await invoke<number>("start_osc", { port })
        setOscEnabled(true)
        setOscPort(String(boundPort))
        setOscError(null)
      }
    } catch (e) {
      setOscError(String(e))
    }
  }

  const handleHttpToggle = async () => {
    try {
      if (httpStatus.running) {
        await invoke("stop_http")
        setHttpEnabled(false)
        setHttpError(null)
      } else {
        const port = parseInt(httpPort) || 8080
        const boundPort = await invoke<number>("start_http", { port })
        setHttpEnabled(true)
        setHttpPort(String(boundPort))
        setHttpError(null)
      }
    } catch (e) {
      setHttpError(String(e))
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* OSC */}
      <div className="flex flex-col gap-3">
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          OSC (Open Sound Control)
        </label>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 flex-1">
            <label className="text-xs text-muted-foreground">Port</label>
            <Input
              type="number"
              value={oscPort}
              onChange={(e) => setOscPort(e.target.value)}
              className="h-7 w-24 text-xs"
              disabled={oscStatus.running}
            />
          </div>
          <StatusDot running={oscStatus.running} />
          <Button
            size="sm"
            variant={oscStatus.running ? "destructive" : "default"}
            onClick={handleOscToggle}
            className="text-xs"
          >
            {oscStatus.running ? "Stop" : "Start"}
          </Button>
        </div>
        {oscError && (
          <p className="text-[0.625rem] text-red-500">{oscError}</p>
        )}
        {oscStatus.running && oscStatus.port && (
          <p className="text-[0.625rem] text-muted-foreground">
            Listening on UDP port {oscStatus.port}
          </p>
        )}
        <p className="text-[0.625rem] text-muted-foreground">
          Receives commands from hardware controllers (Stream Deck, TouchOSC, Companion)
          via OSC over UDP.
        </p>
      </div>

      {/* HTTP API */}
      <div className="flex flex-col gap-3">
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          HTTP API
        </label>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 flex-1">
            <label className="text-xs text-muted-foreground">Port</label>
            <Input
              type="number"
              value={httpPort}
              onChange={(e) => setHttpPort(e.target.value)}
              className="h-7 w-24 text-xs"
              disabled={httpStatus.running}
            />
          </div>
          <StatusDot running={httpStatus.running} />
          <Button
            size="sm"
            variant={httpStatus.running ? "destructive" : "default"}
            onClick={handleHttpToggle}
            className="text-xs"
          >
            {httpStatus.running ? "Stop" : "Start"}
          </Button>
        </div>
        {httpError && (
          <p className="text-[0.625rem] text-red-500">{httpError}</p>
        )}
        {httpStatus.running && httpStatus.port && (
          <p className="text-[0.625rem] text-muted-foreground">
            Serving on http://localhost:{httpStatus.port}/api/v1/
          </p>
        )}
        <p className="text-[0.625rem] text-muted-foreground">
          REST API for status queries and control commands. Use with custom dashboards,
          automation scripts, or HTTP-capable controllers.
        </p>
      </div>

      {/* Firewall guidance */}
      <div className="rounded-lg border border-border bg-muted/30 p-3">
        <p className="text-[0.625rem] font-medium text-muted-foreground mb-1">Firewall Note</p>
        <p className="text-[0.625rem] text-muted-foreground leading-relaxed">
          Your OS may block incoming connections. On macOS, allow Manna through
          System Settings → Network → Firewall. On Windows, allow through
          Windows Security → Firewall → Allow an app.
        </p>
      </div>

      {/* Command Log */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Command Log
          </label>
          {commandLog.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 text-[0.5rem] px-1.5"
              onClick={() => setCommandLog([])}
            >
              Clear
            </Button>
          )}
        </div>
        <div className="h-32 overflow-y-auto rounded-lg border border-border bg-background p-2">
          {commandLog.length === 0 ? (
            <p className="text-[0.625rem] text-muted-foreground text-center mt-8">
              No commands received yet
            </p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {commandLog.map((entry) => (
                <div key={entry.id} className="flex items-center gap-2 text-[0.625rem]">
                  <span className="text-muted-foreground tabular-nums shrink-0">
                    {entry.timestamp}
                  </span>
                  <Badge variant="outline" className="text-[0.5rem] h-3.5 px-1">
                    {entry.source}
                  </Badge>
                  <span className="text-foreground font-mono">{entry.command}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Section: Help                                                             */
/* -------------------------------------------------------------------------- */

function HelpSection() {
  const closeSettings = useSettingsDialogStore((s) => s.closeSettings)

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Resources to help you get the most out of Manna.
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <GraduationCapIcon className="size-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">Interactive Tutorial</p>
              <p className="text-xs text-muted-foreground">
                Step-by-step walkthrough of every feature
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              closeSettings()
              setTimeout(() => {
                useTutorialStore.getState().startTutorial()
              }, 300)
            }}
          >
            <GraduationCapIcon className="mr-1.5 size-3.5" />
            Restart
          </Button>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
          <div>
            <p className="text-sm font-medium">Updates</p>
            <p className="text-xs text-muted-foreground">
              Manna auto-checks daily. Click below for an immediate check.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void checkForUpdates(true)
            }}
          >
            Check for updates
          </Button>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
              <KeyIcon className="size-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">Keyboard Shortcuts</p>
              <p className="text-xs text-muted-foreground">
                Arrow keys navigate the tutorial, Esc to dismiss
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatusDot({ running }: { running: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className={`size-2 rounded-full ${
          running ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/30"
        }`}
      />
      <span className="text-[0.625rem] text-muted-foreground">
        {running ? "Listening" : "Stopped"}
      </span>
    </div>
  )
}

function HymnalsSection() {
  const enabledHymnals = useSettingsStore((s) => s.enabledHymnals)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [busyId, setBusyId] = useState<string | null>(null)

  const refreshCounts = useCallback(async () => {
    try {
      const rows = await invoke<[string, string, number, number][]>("list_hymnal_counts")
      const next: Record<string, number> = {}
      for (const [id, , count] of rows) next[id] = count
      setCounts(next)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    void refreshCounts()
  }, [refreshCounts])

  const handleToggle = async (id: string, on: boolean) => {
    const next = on
      ? Array.from(new Set([...enabledHymnals, id]))
      : enabledHymnals.filter((x) => x !== id)
    await persistEnabledHymnals(next)

    if (on && (counts[id] ?? 0) === 0) {
      setBusyId(id)
      try {
        const seededCount = await invoke<number>("seed_hymnal", { hymnalId: id })
        const { useSongStore } = await import("@/stores/song-store")
        await useSongStore.getState().hydrateSongs()
        await refreshCounts()
        if (seededCount === 0) {
          const { toast } = await import("sonner")
          toast.warning(`${HYMNAL_NAMES[id as HymnalSource] ?? id} hymnal is empty`, {
            description: "Seed data is not bundled yet for this hymnal.",
          })
        }
      } catch (e) {
        console.warn(`[hymnals] seed ${id} failed:`, e)
        const { toast } = await import("sonner")
        toast.error(`Failed to seed ${HYMNAL_NAMES[id as HymnalSource] ?? id}: ${e}`)
      } finally {
        setBusyId(null)
      }
    }
  }

  const handleDeleteAll = async (id: string) => {
    const name = HYMNAL_NAMES[id as HymnalSource] ?? id
    if (!window.confirm(`Delete all ${name} hymns? This cannot be undone.`)) return
    setBusyId(id)
    try {
      await invoke<number>("delete_hymnal_songs", { hymnalId: id })
      await persistEnabledHymnals(enabledHymnals.filter((x) => x !== id))
      const { useSongStore } = await import("@/stores/song-store")
      await useSongStore.getState().hydrateSongs()
      await refreshCounts()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Toggle hymnals on or off. Disabled hymnals stay in the database but are hidden
        from the Songs panel. Delete removes the rows entirely.
      </p>
      {HYMNAL_SOURCES.map((id) => {
        const isEnabled = enabledHymnals.includes(id)
        const count = counts[id] ?? 0
        const seeded = count > 0
        return (
          <div
            key={id}
            className="flex items-center gap-3 rounded-md border border-border p-3"
          >
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={(e) => handleToggle(id, e.target.checked)}
              disabled={busyId === id}
              className="size-4"
            />
            <div className="flex-1">
              <div className="text-sm font-medium">{HYMNAL_NAMES[id]}</div>
              <div className="text-xs text-muted-foreground">
                {seeded ? `${count.toLocaleString()} hymns` : "Not seeded"}
                {busyId === id ? " · working…" : ""}
              </div>
            </div>
            {seeded && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleDeleteAll(id)}
                disabled={busyId === id}
              >
                Delete all
              </Button>
            )}
          </div>
        )
      })}
    </div>
  )
}

const sectionComponents: Record<NavSection, React.FC> = {
  audio: AudioSection,
  speech: SpeechSection,
  bible: BibleSection,
  display: DisplayModeSection,
  branding: BrandingSection,
  presentation: HighlightSettingsSection,
  hymnals: HymnalsSection,
  remote: RemoteControlSection,
  "api-keys": ApiKeysSection,
  storage: StoragePanel,
  projector: ProjectorCalibrationSection,
  help: HelpSection,
}

/*  Main dialog                                                               */
/* -------------------------------------------------------------------------- */

export function SettingsDialog() {
  const open = useSettingsDialogStore((s) => s.isOpen)
  const activeSection = useSettingsDialogStore((s) => s.activeSection)
  const setActiveSection = useSettingsDialogStore((s) => s.setActiveSection)
  const closeSettings = useSettingsDialogStore((s) => s.closeSettings)

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        closeSettings()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open, closeSettings])

  if (!open) return null

  const ActiveContent = sectionComponents[activeSection]

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      className="fixed inset-0 z-50 flex flex-col bg-background animate-in fade-in-0 duration-150"
    >
      <SidebarProvider className="items-start flex-1 min-h-0">
        <Sidebar collapsible="none" className="hidden md:flex h-full w-64 shrink-0">
          <div className="h-14 border-b border-border border-r px-4 flex items-center font-medium text-sm">
            Settings
          </div>
          <SidebarContent className="border-r border-border">
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navGroups.map((group) => {
                    const items = navItems.filter((item) => item.group === group)
                    return (
                      <div key={group} className="space-y-1">
                        <div className="px-2 pt-3 text-[0.625rem] font-semibold uppercase tracking-wider text-muted-foreground/70 first:pt-1">
                          {group}
                        </div>
                        {items.map((item) => (
                          <SidebarMenuItem key={item.id}>
                            <SidebarMenuButton
                              isActive={item.id === activeSection}
                              onClick={() => setActiveSection(item.id)}
                            >
                              {item.icon}
                              <span>{item.name}</span>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        ))}
                      </div>
                    )
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
        <main className="flex h-full flex-1 flex-col overflow-hidden">
          <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-6">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="hidden text-sm font-medium md:block">
                {sectionTitles[activeSection]}
              </div>
              <div className="min-w-0 flex-1 md:hidden">
                <Select
                  value={activeSection}
                  onValueChange={(value) => setActiveSection(value as NavSection)}
                >
                  <SelectTrigger className="h-8 w-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {navGroups.map((group) => (
                      <div key={group}>
                        <div className="px-2 py-1 text-[0.5625rem] font-medium uppercase tracking-wider text-muted-foreground">
                          {group}
                        </div>
                        {navItems
                          .filter((item) => item.group === group)
                          .map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.name}
                            </SelectItem>
                          ))}
                      </div>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={closeSettings}
              aria-label="Close settings"
            >
              <XIcon className="size-4" />
            </Button>
          </header>
          <div className="flex flex-1 flex-col overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl p-8">
              <ActiveContent />
            </div>
          </div>
        </main>
      </SidebarProvider>
    </div>
  )
}
