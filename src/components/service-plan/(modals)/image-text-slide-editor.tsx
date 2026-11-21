import { useSessionStore } from "@/stores/session-store"
import { resolveImageSlideTitle } from "../(lib)/image-text-slide-title"
import { useRef, useState } from "react"
import { toast } from "sonner"
import { ImageIcon, PlayIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { CanvasVerse } from "@/components/ui/canvas-verse"
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer"
import { useBroadcastStore } from "@/stores/broadcast-store"
import type { PlanItem, PlanItemBlank } from "@/types"
import {
  saveImageTextSlide,
  STARBURST_BACKGROUND,
} from "../(lib)/image-text-slide"

export function ImageTextSlideEditor({
  item,
  parsed,
  onClose,
}: {
  item: PlanItem
  parsed: PlanItemBlank
  onClose: () => void
}) {
  const [editedTitle, setEditedTitle] = useState<string | null>(null)
  const session = useSessionStore((s) => s.activeSession)
  const title = resolveImageSlideTitle(item, parsed, session, editedTitle)
  const [body, setBody] = useState(parsed.textOverlay?.body ?? "")
  const [background, setBackground] = useState(
    parsed.imageUrl ?? STARBURST_BACKGROUND
  )
  const [seconds, setSeconds] = useState(
    item.autoAdvanceSeconds?.toString() ?? ""
  )
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const uploadVersion = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const layout = parsed.textOverlay?.layout ?? "title"
  const label = layout === "title" ? "Service title" : "Announcement"
  const theme = useBroadcastStore(
    (s) => s.themes.find((theme) => theme.id === s.activeThemeId) ?? s.themes[0]
  )
  const payload: PlanItemBlank = {
    type: "blank",
    showLogo: false,
    imageUrl: background,
    imageLabel: label,
    textOverlay: { layout, title, body },
  }

  const upload = (file?: File) => {
    if (!file) return
    if (!file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) {
      toast.error("Choose an image smaller than 8 MB.")
      return
    }
    const version = ++uploadVersion.current
    setUploading(true)
    const fail = (message: string) => {
      if (version !== uploadVersion.current) return
      setUploading(false)
      toast.error(message)
    }
    const reader = new FileReader()
    reader.onerror = () => fail("The image could not be read.")
    reader.onload = () => {
      const url = String(reader.result)
      const image = new Image()
      image.onload = () => {
        if (version !== uploadVersion.current) return
        setBackground(url)
        setUploading(false)
      }
      image.onerror = () =>
        fail("This image cannot be displayed. Try PNG or JPEG.")
      image.src = url
    }
    reader.readAsDataURL(file)
  }

  const save = async (goLive: boolean) => {
    if (busy) return
    const duration = seconds.trim() ? Number(seconds) : null
    if (duration !== null && (!Number.isInteger(duration) || duration < 0)) {
      toast.error("Enter a whole number of seconds, or leave it blank.")
      return
    }
    setBusy(true)
    try {
      await saveImageTextSlide(item, payload, duration, goLive)
      onClose()
    } catch (error) {
      toast.error(String(error instanceof Error ? error.message : error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DrawerContent className="right-auto left-1/2 max-h-[90vh] w-full max-w-3xl -translate-x-1/2">
        <DrawerHeader>
          <DrawerTitle>Edit {label.toLowerCase()}</DrawerTitle>
          <DrawerDescription>
            Reuse the background with new words. Save keeps it in the plan; Go
            Live updates the output.
          </DrawerDescription>
        </DrawerHeader>
        <div className="grid gap-5 overflow-y-auto px-4 pb-3 md:grid-cols-2">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="image-slide-title"
                className="text-xs font-medium"
              >
                {layout === "title" ? "Title" : "Headline"}
              </label>
              <Textarea
                id="image-slide-title"
                value={title}
                onChange={(event) => setEditedTitle(event.target.value)}
                maxLength={layout === "title" ? 160 : 140}
                rows={2}
                placeholder={
                  layout === "title" ? "Sunday Service" : "What's happening?"
                }
                disabled={busy}
              />
              {layout === "title" &&
                !parsed.textOverlay?.title.trim() &&
                editedTitle === null && (
                  <p className="text-xs text-muted-foreground">
                    {title
                      ? "Filled from the announced sermon title. You can edit it."
                      : "The announced sermon title will appear here when detected."}
                  </p>
                )}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="image-slide-body" className="text-xs font-medium">
                {layout === "title"
                  ? "Speaker name (optional)"
                  : "Details (optional)"}
              </label>
              <Textarea
                id="image-slide-body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                maxLength={600}
                rows={4}
                placeholder={
                  layout === "title"
                    ? "Speaker name"
                    : "Date, location, and other details"
                }
                disabled={busy}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                className="hidden"
                aria-label="Background image"
                onChange={(event) => {
                  upload(event.target.files?.[0])
                  event.target.value = ""
                }}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                <ImageIcon className="size-3.5" /> Change background
              </Button>
              {background !== STARBURST_BACKGROUND && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    uploadVersion.current++
                    setUploading(false)
                    setBackground(STARBURST_BACKGROUND)
                  }}
                >
                  Use Starburst
                </Button>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="image-slide-duration"
                className="text-xs font-medium"
              >
                Auto-advance seconds (optional)
              </label>
              <Input
                id="image-slide-duration"
                type="number"
                min={0}
                value={seconds}
                onChange={(event) => setSeconds(event.target.value)}
                disabled={busy}
                placeholder="Manual"
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Preview
            </span>
            {theme && (
              <div className="overflow-hidden rounded-md border bg-black">
                <CanvasVerse
                  theme={theme}
                  verse={null}
                  fullscreenImage={{
                    url: background,
                    label,
                    textOverlay: payload.textOverlay,
                  }}
                />
              </div>
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">
              Text fits automatically above the background artwork. Use short
              lines for the clearest result.
            </p>
          </div>
        </div>
        <DrawerFooter className="flex flex-row justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="outline"
            disabled={busy || uploading || !title.trim()}
            onClick={() => void save(false)}
          >
            Save
          </Button>
          <Button
            disabled={busy || uploading || !title.trim()}
            onClick={() => void save(true)}
          >
            <PlayIcon className="size-3.5" />
            {busy ? "Saving…" : "Save & Go Live"}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
