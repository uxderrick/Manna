import { useState } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import { invoke } from "@tauri-apps/api/core"
import { Button } from "@/components/ui/button"

/** Recovery for artwork removed from public installers. Does not import keys. */
export function PrivateChurchArtwork() {
  const [status, setStatus] = useState("")
  const [busy, setBusy] = useState(false)
  const restore = async () => {
    setBusy(true)
    try {
      const source = await open({
        directory: true,
        multiple: false,
        title: "Choose the legacy church artwork folder",
      })
      if (!source) return
      const count = await invoke<number>("import_private_church_assets", {
        source,
      })
      setStatus(
        `Preserved ${count} artwork files. Reopen Manna when you are ready to use them. Existing artwork was kept.`
      )
    } catch {
      setStatus(
        "Could not import this folder. Choose a legacy Manna artwork pack."
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="space-y-2 border-t pt-4">
      <p className="text-xs font-medium">Restore legacy church artwork</p>
      <p className="text-xs text-muted-foreground">
        Optional: restore the artwork pack from an older church setup. For new
        designs, use the image and slide settings above.
      </p>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => void restore()}
      >
        {busy ? "Importing…" : "Choose artwork folder"}
      </Button>
      {status && (
        <p role="status" className="text-xs text-muted-foreground">
          {status}
        </p>
      )}
    </section>
  )
}
