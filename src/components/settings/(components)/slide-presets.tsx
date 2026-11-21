import { resolveChurchAsset } from "@/lib/church-assets"
import { useState } from "react"
import { PencilIcon } from "lucide-react"
import { useSettingsStore } from "@/stores/settings-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { CanvasVerse } from "@/components/ui/canvas-verse"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { givingSlide } from "@/lib/giving-slide"
import { resolveBrandAsset } from "@/lib/brand"
import type { SlidePresetId } from "@/lib/church-profile"
import type { PlanItemBlank } from "@/types"
import {
  profileTitlePresets,
  profileWelcomeSlide,
  applyProfilePreset,
} from "@/components/service-plan/(lib)/profile-slide-presets"
import { CLOSING_SLIDE } from "@/components/service-plan/(lib)/closing-slide"
import { JESUS_SLIDES } from "@/components/service-plan/(lib)/jesus-slides"
import { GivingDetails } from "./giving-details"
import { ChurchProfileAssets } from "./church-profile-assets"
import { SlidePresetEditor } from "../(modals)/slide-preset-editor"

export function SlidePresets() {
  const brand = useSettingsStore((s) => s.brand)
  const theme = useBroadcastStore(
    (s) => s.themes.find((t) => t.id === s.activeThemeId) ?? s.themes[0]
  )
  const [editing, setEditing] = useState<SlidePresetId | "giving" | null>(null)
  const titles = profileTitlePresets(brand)
  const presets: {
    id: SlidePresetId
    label: string
    payload: PlanItemBlank
  }[] = [
    {
      id: "welcome",
      label: "Welcome",
      payload: profileWelcomeSlide(brand).payload,
    },
    { id: "title", label: "Sermon title", payload: titles[0] },
    { id: "announcement", label: "Announcement", payload: titles[1] },
    {
      id: "jesus",
      label: "Jesus",
      payload: applyProfilePreset(brand, "jesus", {
        ...JESUS_SLIDES[0],
        ...(brand.jesusImagePath
          ? { imageUrl: resolveBrandAsset("jesus", brand.jesusImagePath) }
          : {}),
      }),
    },
    {
      id: "closing",
      label: "Closing",
      payload: applyProfilePreset(brand, "closing", CLOSING_SLIDE),
    },
  ]
  const selected = presets.find((p) => p.id === editing)
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Set the starting design for each slide.
      </p>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {presets.map(({ id, label, payload }) => (
          <div key={id} className="overflow-hidden rounded-lg border">
            <div
              className="pointer-events-none overflow-hidden bg-black"
              aria-label={`${label} preview`}
            >
              {theme ? (
                <CanvasVerse
                  theme={theme}
                  verse={null}
                  fullscreenImage={{
                    url: payload.imageUrl!,
                    label,
                    textOverlay: payload.textOverlay
                      ? {
                          ...payload.textOverlay,
                          title:
                            payload.textOverlay.title ||
                            (id === "title"
                              ? "Sermon title"
                              : id === "announcement"
                                ? "Announcement"
                                : ""),
                        }
                      : undefined,
                  }}
                />
              ) : (
                <img
                  src={resolveChurchAsset(payload.imageUrl!)}
                  alt={label}
                  className="aspect-video w-full object-contain"
                />
              )}
            </div>
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="text-xs font-medium">{label}</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => setEditing(id)}
                aria-label={`Edit ${label} default`}
              >
                <PencilIcon className="size-3" />
                Edit default
              </Button>
            </div>
          </div>
        ))}
        <div className="overflow-hidden rounded-lg border">
          <img
            src={resolveChurchAsset(givingSlide(brand).url!)}
            alt="Giving preview"
            className="aspect-video w-full bg-black object-contain"
          />
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="text-xs font-medium">Giving</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => setEditing("giving")}
            >
              <PencilIcon className="size-3" />
              Edit default
            </Button>
          </div>
        </div>
      </div>
      {selected && (
        <SlidePresetEditor
          key={selected.id}
          {...selected}
          onClose={() => setEditing(null)}
        />
      )}
      {editing === "giving" && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null)
          }}
        >
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Giving default</DialogTitle>
              <DialogDescription>
                Uses the same payment details as Giving settings.
              </DialogDescription>
            </DialogHeader>
            <GivingDetails />
            <ChurchProfileAssets kinds={["momo"]} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
