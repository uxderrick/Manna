import { ConnectionOnly } from "./connection-only"
import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

type Messaging = {
  configured: boolean
  senderId: string
  contactListId: string
}
export function ChurchMessaging() {
  const [saved, setSaved] = useState<Messaging | null>(null)
  const [sender, setSender] = useState("")
  const [list, setList] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    let active = true
    void invoke<Messaging>("get_comms360_settings")
      .then((value) => {
        if (active) {
          setSaved(value)
          setSender(value.senderId)
          setList(value.contactListId)
        }
      })
      .catch(() => {
        if (active) setError("Could not load messaging settings.")
      })
    return () => {
      active = false
    }
  }, [])
  const save = async () => {
    setSaving(true)
    setError("")
    try {
      const value = await invoke<Messaging>("save_comms360_settings", {
        apiKey: "",
        senderId: sender,
        contactListId: list,
      })
      setSaved(value)
      setSender(value.senderId)
      setList(value.contactListId)
      toast.success("Messaging settings saved")
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="space-y-5">
      <ConnectionOnly kind="publishing">
        <div className="rounded-lg border p-4">
          <p className="text-xs font-medium">Sermon website</p>
          <a
            href="https://sermon.ewcadentan.com"
            target="_blank"
            rel="noreferrer"
            className="mt-1 block text-xs text-muted-foreground underline underline-offset-4"
          >
            sermon.ewcadentan.com
          </a>
        </div>
      </ConnectionOnly>
      {saved?.configured ? (
        <>
          <label className="block space-y-1.5 text-xs font-medium">
            Approved sender ID
            <Input
              value={sender}
              onChange={(e) => setSender(e.target.value)}
              maxLength={11}
              disabled={saving || !saved.configured}
            />
          </label>
          <label className="block space-y-1.5 text-xs font-medium">
            Contact list ID
            <Input
              value={list}
              onChange={(e) => setList(e.target.value)}
              disabled={saving || !saved.configured}
            />
          </label>
          {!saved.configured && (
            <p className="text-xs text-muted-foreground">
              Connect Comms360 in API Keys first.
            </p>
          )}
          <Button
            size="sm"
            disabled={
              !saved.configured ||
              saving ||
              !sender.trim() ||
              (sender === saved.senderId && list === saved.contactListId)
            }
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save messaging"}
          </Button>
        </>
      ) : (
        !error && (
          <p className="text-xs text-muted-foreground">
            {saved
              ? "Copy messages from the SMS tab into your own service."
              : "Loading…"}
          </p>
        )
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
