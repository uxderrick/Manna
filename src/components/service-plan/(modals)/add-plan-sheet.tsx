import { resolveChurchAsset } from "@/lib/church-assets"
import { CLOSING_SLIDE } from "../(lib)/closing-slide"
import { PRAYER_SLIDE } from "../(lib)/prayer-slide"
import {
  applyProfilePreset,
  profileTitlePresets,
  profileWelcomeSlide,
} from "../(lib)/profile-slide-presets"
import { XIcon } from "lucide-react"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerClose,
} from "@/components/ui/drawer"
import { Button } from "@/components/ui/button"
import { useSettingsStore } from "@/stores/settings-store"
import { resolveBrandAsset } from "@/lib/brand"
import { givingSlide } from "@/lib/giving-slide"
import type { PlanItemPayload } from "@/types"
import { WELCOME_MOTION_SLIDE } from "../(lib)/welcome-slide"
import { JESUS_SLIDES } from "../(lib)/jesus-slides"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  adding: boolean
  onAdd: (payload: PlanItemPayload) => void
}

export function AddPlanSheet({ open, onOpenChange, adding, onAdd }: Props) {
  const brand = useSettingsStore((s) => s.brand)
  const slides: Array<{
    label: string
    image: string
    payload: PlanItemPayload
  }> = [
    { label: "Prayer", image: PRAYER_SLIDE.imageUrl!, payload: PRAYER_SLIDE },
    ...profileTitlePresets(brand).map((payload) => ({
      label: payload.imageLabel!,
      image: payload.imageUrl!,
      payload,
    })),
    profileWelcomeSlide(brand),
    {
      label: "Welcome — Motion",
      image: WELCOME_MOTION_SLIDE.imageUrl!,
      payload: WELCOME_MOTION_SLIDE,
    },
    {
      label: "Giving",
      image: givingSlide(brand).url,
      payload: { type: "momo" },
    },
    {
      label: "Thank You — Closing",
      image: applyProfilePreset(brand, "closing", CLOSING_SLIDE).imageUrl!,
      payload: applyProfilePreset(brand, "closing", CLOSING_SLIDE),
    },
    ...JESUS_SLIDES.map((original, index) => {
      const payload =
        index === 0
          ? applyProfilePreset(brand, "jesus", {
              ...original,
              ...(brand.jesusImagePath
                ? { imageUrl: resolveBrandAsset("jesus", brand.jesusImagePath) }
                : {}),
            })
          : original
      return {
        label: payload.imageLabel!,
        image: payload.imageUrl!,
        payload,
      }
    }),
  ]

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        className="right-auto left-1/2 max-h-[85vh] w-full max-w-2xl -translate-x-1/2"
        style={{ animationDuration: "150ms", transitionDuration: "150ms" }}
      >
        <DrawerHeader>
          <div className="flex items-center justify-between gap-3">
            <DrawerTitle>Add a slide</DrawerTitle>
            <DrawerClose asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Close add sheet"
              >
                <XIcon className="size-4" />
              </Button>
            </DrawerClose>
          </div>
          <DrawerDescription>
            Choose a slide to add to your service plan.
          </DrawerDescription>
        </DrawerHeader>
        <div className="min-h-0 overflow-y-auto px-4 pb-5" aria-busy={adding}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {slides.map(({ label, image, payload }) => (
              <button
                key={label}
                disabled={adding}
                onClick={() => onAdd(payload)}
                aria-label={`Add ${label}`}
                className="overflow-hidden rounded-lg border text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
              >
                <img
                  src={resolveChurchAsset(image!)}
                  alt={label}
                  loading="lazy"
                  decoding="async"
                  width={384}
                  height={216}
                  className="aspect-video w-full bg-black object-contain"
                />
                <span className="block p-3 text-sm font-medium">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
