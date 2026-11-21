import type {
  VerifyState,
  VerifyResult,
} from "../(lib)/credential-verification"
import { useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { CheckIcon } from "lucide-react"
import { useSettingsStore, persistDeepseekApiKey } from "@/stores"

export function DeepseekCredential() {
  const { deepseekApiKey } = useSettingsStore()

  const [deepseekKeyValue, setDeepseekKeyValue] = useState(deepseekApiKey ?? "")

  const [deepseekSaved, setDeepseekSaved] = useState(false)

  const [deepseekVerify, setDeepseekVerify] = useState<VerifyState>({
    status: "idle",
  })

  const handleSaveDeepseekKey = async () => {
    if (!(await persistDeepseekApiKey(deepseekKeyValue || null))) return
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
        if (deepseekKeyValue !== deepseekApiKey)
          if (!(await persistDeepseekApiKey(deepseekKeyValue))) throw new Error("Could not save key securely")
      } else {
        setDeepseekVerify({ status: "fail", detail: result.detail })
      }
    } catch (e) {
      setDeepseekVerify({ status: "fail", detail: String(e) })
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          DeepSeek API Key
        </label>
        {deepseekApiKey ? (
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
        <p className="text-[0.625rem] text-emerald-500">
          {deepseekVerify.detail}
        </p>
      )}
      {deepseekVerify.status === "fail" && (
        <p className="text-[0.625rem] text-destructive">
          {deepseekVerify.detail}
        </p>
      )}
      <p className="text-[0.625rem] text-muted-foreground">
        Used for AI sermon summaries. Get a key at{" "}
        <span className="text-primary">platform.deepseek.com</span>
      </p>
    </div>
  )
}
