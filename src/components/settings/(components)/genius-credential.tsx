import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { CheckIcon } from "lucide-react"
import { useSettingsStore, persistGeniusToken } from "@/stores"

export function GeniusCredential() {
  const { geniusToken } = useSettingsStore()

  const [geniusValue, setGeniusValue] = useState(geniusToken ?? "")

  const [geniusSaved, setGeniusSaved] = useState(false)

  const handleSaveGeniusToken = async () => {
    if (!(await persistGeniusToken(geniusValue || null))) return
    setGeniusSaved(true)
    setTimeout(() => setGeniusSaved(false), 2000)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          Genius API Token
        </label>
        {geniusToken ? (
          <Badge variant="outline" className="text-[0.5rem]">
            Token configured
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
  )
}
