import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { CheckIcon } from "lucide-react"
import { useSettingsStore, persistUnsplashApiKey } from "@/stores"

export function UnsplashCredential() {
  const { unsplashApiKey } = useSettingsStore()

  const [unsplashValue, setUnsplashValue] = useState(unsplashApiKey ?? "")

  const [unsplashSaved, setUnsplashSaved] = useState(false)

  const handleSaveUnsplash = async () => {
    if (!(await persistUnsplashApiKey(unsplashValue || null))) return
    setUnsplashSaved(true)
    setTimeout(() => setUnsplashSaved(false), 2000)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          Unsplash API Key
        </label>
        {unsplashApiKey ? (
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
          placeholder="Paste Unsplash Access Key..."
          value={unsplashValue}
          onChange={(e) => setUnsplashValue(e.target.value)}
          className="flex-1 text-xs"
        />
        <Button size="sm" onClick={handleSaveUnsplash}>
          {unsplashSaved ? (
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
        <span className="text-primary">unsplash.com/developers</span>
      </p>
    </div>
  )
}
