import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { CheckIcon } from "lucide-react"
import { useSettingsStore, persistPexelsApiKey } from "@/stores"

export function PexelsCredential() {
  const { pexelsApiKey } = useSettingsStore()

  const [pexelsValue, setPexelsValue] = useState(pexelsApiKey ?? "")

  const [pexelsSaved, setPexelsSaved] = useState(false)

  const handleSavePexels = async () => {
    if (!(await persistPexelsApiKey(pexelsValue || null))) return
    setPexelsSaved(true)
    setTimeout(() => setPexelsSaved(false), 2000)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          Pexels API Key
        </label>
        {pexelsApiKey ? (
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
          placeholder="Paste Pexels API key..."
          value={pexelsValue}
          onChange={(e) => setPexelsValue(e.target.value)}
          className="flex-1 text-xs"
        />
        <Button size="sm" onClick={handleSavePexels}>
          {pexelsSaved ? (
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
        Free image search. Sign up at{" "}
        <span className="text-primary">pexels.com/api</span>
      </p>
    </div>
  )
}
