import { useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  persistDeepgramApiKey,
  persistAssemblyAiApiKey,
  persistSttProvider,
} from "@/stores/settings-store"

type Provider = "deepgram" | "assemblyai"

interface VerifyResult {
  ok: boolean
  detail: string
}

export function ApiKeyStep({ onContinue }: { onContinue: () => void | Promise<void> }) {
  const [provider, setProvider] = useState<Provider>("deepgram")
  const [key, setKey] = useState("")
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; detail: string } | null>(null)

  const handleTest = async () => {
    if (!key.trim()) {
      setStatus({ ok: false, detail: "Enter a key first." })
      return
    }
    setTesting(true)
    setStatus(null)
    try {
      const cmd = provider === "deepgram" ? "verify_deepgram_key" : "verify_assemblyai_key"
      const result = await invoke<VerifyResult>(cmd, { apiKey: key })
      setStatus(result)
    } catch (e) {
      setStatus({ ok: false, detail: e instanceof Error ? e.message : String(e) })
    } finally {
      setTesting(false)
    }
  }

  const handleSaveAndContinue = async () => {
    if (!key.trim()) return
    setSaving(true)
    try {
      if (provider === "deepgram") await persistDeepgramApiKey(key)
      else await persistAssemblyAiApiKey(key)
      await persistSttProvider(provider)
      await onContinue()
    } finally {
      setSaving(false)
    }
  }

  const handleSkip = async () => {
    await onContinue()
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Speech recognition provider</h2>
        <p className="text-sm text-muted-foreground">
          Needed to transcribe sermons live. You can also set this up later in Settings.
        </p>
      </div>

      <RadioGroup
        value={provider}
        onValueChange={(v) => {
          setProvider(v as Provider)
          setStatus(null)
        }}
        className="flex gap-4"
      >
        <label className="flex cursor-pointer items-center gap-2">
          <RadioGroupItem value="deepgram" id="provider-deepgram" />
          <span>Deepgram</span>
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <RadioGroupItem value="assemblyai" id="provider-assemblyai" />
          <span>AssemblyAI</span>
        </label>
      </RadioGroup>

      <div className="flex gap-2">
        <Input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={`Paste ${provider === "deepgram" ? "Deepgram" : "AssemblyAI"} API key`}
          className="flex-1"
        />
        <Button variant="outline" onClick={handleTest} disabled={testing || !key.trim()}>
          {testing ? "Testing…" : "Test"}
        </Button>
      </div>

      {status && (
        <p className={status.ok ? "text-sm text-emerald-500" : "text-sm text-destructive"}>
          {status.ok ? "✓ " : "✗ "}
          {status.detail}
        </p>
      )}

      <div className="flex items-center justify-between border-t border-border pt-3 text-sm">
        <button
          type="button"
          onClick={handleSkip}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          Skip for now
        </button>
        <Button onClick={handleSaveAndContinue} disabled={!key.trim() || saving}>
          {saving ? "Saving…" : "Save & Continue"}
        </Button>
      </div>
    </div>
  )
}
