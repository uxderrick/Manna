import { useState } from "react"
import { LinkIcon } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function AddYouTubeLink({
  onAdd,
}: {
  onAdd: (url: string, label: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState("")
  const [label, setLabel] = useState("")
  const [status, setStatus] = useState<"idle" | "saving">("idle")
  const [error, setError] = useState("")
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (status !== "saving") {
          setOpen(value)
          setError("")
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="shrink-0 gap-1 text-xs">
          <LinkIcon className="size-3" />
          YouTube
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add YouTube link</DialogTitle>
          <DialogDescription>
            Streams with audio on the main projector output. Internet is
            required. NDI is not supported.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={async (event) => {
            event.preventDefault()
            setError("")
            setStatus("saving")
            try {
              await onAdd(url, label)
              setOpen(false)
              setUrl("")
              setLabel("")
            } catch (error) {
              setError(error instanceof Error ? error.message : String(error))
            } finally {
              setStatus("idle")
            }
          }}
        >
          <label className="grid gap-1.5 text-sm">
            YouTube link
            <Input
              type="url"
              required
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://www.youtube.com/watch?v=…"
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            Name (optional)
            <Input
              value={label}
              maxLength={160}
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" disabled={status === "saving"}>
            {status === "saving" ? "Adding…" : "Add link"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
