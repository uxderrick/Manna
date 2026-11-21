import { resolveChurchAsset } from "@/lib/church-assets"
import { useState } from "react"
import { ImageIcon } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { CanvasVerse } from "@/components/ui/canvas-verse"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { persistBrandConfig, useSettingsStore } from "@/stores/settings-store"
import type { SlidePresetId } from "@/lib/church-profile"
import type { PlanItemBlank } from "@/types"
import { readPresetImage } from "../(lib)/preset-image"

export function SlidePresetEditor({
  id,
  label,
  payload,
  onClose,
}: {
  id: SlidePresetId
  label: string
  payload: PlanItemBlank
  onClose: () => void
}) {
  const [image, setImage] = useState(payload.imageUrl!)
  const [title, setTitle] = useState(payload.textOverlay?.title ?? "")
  const [body, setBody] = useState(payload.textOverlay?.body ?? "")
  const [mode, setMode] = useState<"idle" | "uploading" | "saving">("idle")
  const theme = useBroadcastStore(
    (s) => s.themes.find((t) => t.id === s.activeThemeId) ?? s.themes[0]
  )
  const overlay =
    payload.textOverlay || title.trim() || body.trim()
      ? {
          layout: payload.textOverlay?.layout ?? ("announcement" as const),
          title,
          body,
        }
      : undefined
  const save = async (reset = false) => {
    setMode("saving")
    const presets = { ...useSettingsStore.getState().brand.slidePresets }
    if (reset) delete presets[id]
    else presets[id] = { imageUrl: image, title, body }
    const saved = await persistBrandConfig({ slidePresets: presets })
    setMode("idle")
    if (!saved) {
      toast.error("Could not save preset. Try again.")
      return
    }
    toast.success(reset ? "Default restored" : "Slide default saved")
    onClose()
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && mode === "idle") onClose()
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            Used for new slides. Existing slides stay unchanged.
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-hidden rounded-lg border bg-black">
          {theme ? (
            <CanvasVerse
              theme={theme}
              verse={null}
              fullscreenImage={{ url: image, label, textOverlay: overlay }}
            />
          ) : (
            <img
              src={resolveChurchAsset(image)}
              alt={`${label} preview`}
              className="aspect-video w-full object-contain"
            />
          )}
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 self-start text-xs font-medium">
          <ImageIcon className="size-3.5" />
          {mode === "uploading" ? "Preparing image…" : "Change background"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            disabled={mode !== "idle"}
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (!file) return
              setMode("uploading")
              try {
                setImage(await readPresetImage(file))
              } catch (error) {
                toast.error(
                  String(error instanceof Error ? error.message : error)
                )
              } finally {
                setMode("idle")
              }
            }}
          />
        </label>
        <label className="space-y-1.5 text-xs font-medium">
          {id === "title" ? "Title placeholder" : "Default title"}
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            disabled={mode !== "idle"}
            placeholder={
              id === "title"
                ? "Leave blank for the announced title"
                : "Optional"
            }
          />
        </label>
        <label className="space-y-1.5 text-xs font-medium">
          {id === "title" ? "Speaker" : "Supporting text"}
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={600}
            disabled={mode !== "idle"}
            rows={2}
          />
        </label>
        <DialogFooter>
          <Button
            size="sm"
            variant="ghost"
            disabled={mode !== "idle"}
            onClick={() => void save(true)}
          >
            Restore default
          </Button>
          <Button
            size="sm"
            disabled={mode !== "idle"}
            onClick={() => void save()}
          >
            {mode === "saving" ? "Saving…" : "Save default"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
