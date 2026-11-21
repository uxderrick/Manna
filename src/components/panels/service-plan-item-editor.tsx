import { resolveChurchAsset } from "@/lib/church-assets"
import { ImageTextSlideEditor } from "@/components/service-plan/(modals)/image-text-slide-editor"
import { PrayerSlideEditor } from "@/components/service-plan/(modals)/prayer-slide-editor"
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import type { PlanItem, PlanItemPayload } from "@/types"
import { parsePlanItem } from "@/types"
import { useServicePlan } from "@/hooks/use-service-plan"
import { useAnnouncementDialogStore } from "@/lib/announcement-dialog"

interface Props {
  item: PlanItem | null
  onClose: () => void
}

export function ServicePlanItemEditor({ item, onClose }: Props) {
  const parsed = item ? parsePlanItem(item) : null
  useEffect(() => {
    if (item && parsed?.type === "announcement") {
      useAnnouncementDialogStore.getState().openAnnouncementForEdit(item)
      onClose()
    }
  }, [item, parsed?.type, onClose])
  if (!item || !parsed || parsed.type === "announcement") return null
  if (parsed.type === "blank" && parsed.prayer) return <PrayerSlideEditor key={item.id} item={item} content={parsed.prayer} onClose={onClose} />
  if (parsed.type === "blank" && parsed.textOverlay) return <ImageTextSlideEditor key={item.id} item={item} parsed={parsed} onClose={onClose} />
  return <ItemEditor key={item.id} item={item} parsed={parsed} onClose={onClose} />
}

function ItemEditor({ item, parsed, onClose }: {
  item: PlanItem
  parsed: Exclude<PlanItemPayload, { type: "announcement" }>
  onClose: () => void
}) {
  const { updateItem } = useServicePlan()
  const [label, setLabel] = useState(parsed.type === "section" ? parsed.label : "")
  const [autoAdvance, setAutoAdvance] = useState(item.autoAdvanceSeconds?.toString() ?? "")
  const [blankShowLogo, setBlankShowLogo] = useState(parsed.type === "blank" ? parsed.showLogo : true)
  const [blankImageUrl, setBlankImageUrl] = useState(parsed.type === "blank" ? parsed.imageUrl : undefined)
  const [blankImageLabel, setBlankImageLabel] = useState(parsed.type === "blank" ? parsed.imageLabel ?? "" : "")

  const pickImage = () => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = "image/*"
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => setBlankImageUrl(reader.result as string)
      reader.readAsDataURL(file)
    }
    input.click()
  }

  const save = async () => {
    let payload: PlanItemPayload
    if (parsed.type === "section") {
      payload = { type: "section", label }
    } else if (parsed.type === "blank") {
      payload = {
        type: "blank",
        showLogo: blankShowLogo,
        ...(blankImageUrl ? { imageUrl: blankImageUrl } : {}),
        ...(blankImageLabel.trim() ? { imageLabel: blankImageLabel.trim() } : {}),
      }
    } else {
      onClose()
      return
    }
    const seconds = autoAdvance.trim() === "" ? null : Number(autoAdvance)
    await updateItem(item, payload, Number.isFinite(seconds) ? (seconds as number | null) : null)
    onClose()
  }

  return (
    <Drawer open={item != null} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="left-1/2 right-auto max-h-[85vh] w-full max-w-2xl -translate-x-1/2">
        <DrawerHeader>
          <DrawerTitle>
            Edit {parsed.type === "blank" ? "blank slide" : "section"}
          </DrawerTitle>
        </DrawerHeader>
        <div className="flex flex-col gap-3 overflow-y-auto px-4 pb-2">
          {parsed.type === "section" ? (
            <div>
              <label className="text-xs font-medium">Label</label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
          ) : parsed.type === "blank" ? (
            <>
              <div>
                <label className="text-xs font-medium">Image</label>
                <div className="mt-1 flex flex-col gap-2">
                  {blankImageUrl && (
                    <img
                      src={resolveChurchAsset(blankImageUrl!)}
                      alt="Blank slide image"
                      className="max-h-40 rounded-md border bg-black object-contain"
                    />
                  )}
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={pickImage}>
                      {blankImageUrl ? "Replace image" : "Upload image"}
                    </Button>
                    {blankImageUrl && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setBlankImageUrl(undefined)}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
              </div>
              {blankImageUrl && (
                <div>
                  <label className="text-xs font-medium">Image label (optional)</label>
                  <Input
                    value={blankImageLabel}
                    onChange={(e) => setBlankImageLabel(e.target.value)}
                    placeholder="e.g. Welcome, Offering, Communion"
                  />
                </div>
              )}
              {!blankImageUrl && (
                <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
                  <label className="text-xs font-medium">Show church logo</label>
                  <input
                    type="checkbox"
                    checked={blankShowLogo}
                    onChange={(e) => setBlankShowLogo(e.target.checked)}
                  />
                </div>
              )}
            </>
          ) : null}
          <div>
            <label className="text-xs font-medium">Auto-advance (seconds, blank = manual)</label>
            <Input
              type="number"
              min={0}
              value={autoAdvance}
              onChange={(e) => setAutoAdvance(e.target.value)}
            />
          </div>
        </div>
        <DrawerFooter className="flex flex-row justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
