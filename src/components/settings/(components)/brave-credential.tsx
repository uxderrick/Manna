import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { CheckIcon } from "lucide-react"
import { useSettingsStore, persistBraveApiKey } from "@/stores"

export function BraveCredential() {
  const { braveApiKey } = useSettingsStore()

  const [braveValue, setBraveValue] = useState(braveApiKey ?? "")

  const [braveSaved, setBraveSaved] = useState(false)

  const handleSaveBrave = async () => {
    if (!(await persistBraveApiKey(braveValue || null))) return
    setBraveSaved(true)
    setTimeout(() => setBraveSaved(false), 2000)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          Brave Search API Key
        </label>
        {braveApiKey ? (
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
          placeholder="Paste Brave Subscription Token..."
          value={braveValue}
          onChange={(e) => setBraveValue(e.target.value)}
          className="flex-1 text-xs"
        />
        <Button size="sm" onClick={handleSaveBrave}>
          {braveSaved ? (
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
        Web-wide image results. 2,000 queries/mo free. Sign up at{" "}
        <span className="text-primary">brave.com/search/api</span>
      </p>
    </div>
  )
}
