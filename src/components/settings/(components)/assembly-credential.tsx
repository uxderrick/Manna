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
import { useSettingsStore, persistAssemblyAiApiKey } from "@/stores"

export function AssemblyCredential() {
  const { assemblyAiApiKey } = useSettingsStore()

  const [assemblyKeyValue, setAssemblyKeyValue] = useState(
    assemblyAiApiKey ?? ""
  )

  const [assemblySaved, setAssemblySaved] = useState(false)

  const [assemblyVerify, setAssemblyVerify] = useState<VerifyState>({
    status: "idle",
  })

  const handleSaveAssemblyKey = async () => {
    if (!(await persistAssemblyAiApiKey(assemblyKeyValue || null))) return
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
        if (assemblyKeyValue !== assemblyAiApiKey)
          if (!(await persistAssemblyAiApiKey(assemblyKeyValue))) throw new Error("Could not save key securely")
      } else {
        setAssemblyVerify({ status: "fail", detail: result.detail })
      }
    } catch (e) {
      setAssemblyVerify({ status: "fail", detail: String(e) })
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          AssemblyAI API Key
        </label>
        {assemblyAiApiKey ? (
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
          Required for live transcription when AssemblyAI is selected. Get a key
          at <span className="text-primary">assemblyai.com</span>
        </p>
      )}
    </div>
  )
}
