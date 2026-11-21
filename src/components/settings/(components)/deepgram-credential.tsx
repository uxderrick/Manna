import type {
  VerifyState,
  VerifyResult,
} from "../(lib)/credential-verification"
import { useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { CheckIcon, Loader2Icon, XIcon } from "lucide-react"
import { useSettingsStore, persistDeepgramApiKey } from "@/stores"

export function DeepgramCredential() {
  const { deepgramApiKey, sttProvider } = useSettingsStore()

  const [deepgramKeyValue, setDeepgramKeyValue] = useState(deepgramApiKey ?? "")

  const [deepgramSaved, setDeepgramSaved] = useState(false)

  const [deepgramVerify, setDeepgramVerify] = useState<VerifyState>({
    status: "idle",
  })

  const handleSaveDeepgramKey = async () => {
    if (!(await persistDeepgramApiKey(deepgramKeyValue || null))) return
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
        if (deepgramKeyValue !== deepgramApiKey)
          if (!(await persistDeepgramApiKey(deepgramKeyValue))) throw new Error("Could not save key securely")
      } else {
        setDeepgramVerify({ status: "fail", detail: result.detail })
      }
    } catch (e) {
      setDeepgramVerify({ status: "fail", detail: String(e) })
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          Deepgram API Key
        </label>
        {deepgramApiKey ? (
          <Badge variant="outline" className="text-[0.5rem]">
            Key configured
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="text-[0.5rem] text-muted-foreground"
          >
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
  )
}
