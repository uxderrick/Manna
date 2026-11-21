import { resolveChurchAsset } from "@/lib/church-assets"
import { toast } from "sonner"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { invoke } from "@tauri-apps/api/core"
import { open as openDialog } from "@tauri-apps/plugin-dialog"
import { useSettingsStore } from "@/stores"
import { persistBrandConfig } from "@/stores/settings-store"
import {
  resolveBlankBackground,
  resolveBrandAsset,
  type BrandAssetKind,
} from "@/lib/brand"
import { Button } from "@/components/ui/button"

const IMAGE_EXTS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "tif",
  "tiff",
  "avif",
  "heic",
  "heif",
  "svg",
  "ico",
  "jfif",
  "apng",
]

const ASSET_ROWS: {
  kind: BrandAssetKind
  label: string
  field: "logoPath" | "blankImagePath" | "momoImagePath" | "jesusImagePath"
}[] = [
  { kind: "logo", label: "App logo (sessions screen)", field: "logoPath" },
  {
    kind: "blank",
    label: "Blank-slide image (projector)",
    field: "blankImagePath",
  },
  { kind: "momo", label: "Custom giving slide image", field: "momoImagePath" },
  { kind: "jesus", label: "Jesus slide image", field: "jesusImagePath" },
]

export function ChurchProfileAssets({ kinds }: { kinds: BrandAssetKind[] }) {
  const brand = useSettingsStore((s) => s.brand)
  const pickAsset = async (
    kind: BrandAssetKind,
    field: (typeof ASSET_ROWS)[number]["field"]
  ) => {
    const file = await openDialog({
      directory: false,
      multiple: false,
      filters: [{ name: "Images", extensions: IMAGE_EXTS }],
    })
    if (typeof file !== "string") return
    try {
      const stored = await invoke<string>("save_brand_asset", {
        kind,
        srcPath: file,
      })
      if (!(await persistBrandConfig({ [field]: stored })))
        throw new Error("The selected image could not be saved.")
      useBroadcastStore.getState().syncBroadcastOutput()
    } catch (e) {
      toast.error(`Could not save image: ${String(e)}`)
    }
  }

  const resetAsset = async (
    kind: BrandAssetKind,
    field: (typeof ASSET_ROWS)[number]["field"]
  ) => {
    if (!(await persistBrandConfig({ [field]: null }))) {
      toast.error("Could not reset image. Try again.")
      return
    }
    try {
      await invoke("delete_brand_asset", { kind })
    } catch {
      // The settings no longer reference the file; cleanup can be retried later.
    }
    useBroadcastStore.getState().syncBroadcastOutput()
  }

  return (
    <div className="space-y-4">
      {ASSET_ROWS.filter(
        (row) =>
          kinds.includes(row.kind) &&
          (row.kind !== "blank" || !resolveBlankBackground(brand).videoUrl)
      ).map(({ kind, label, field }) => (
        <div key={kind} className="flex items-center gap-3">
          <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-black/40">
            <img
              src={resolveChurchAsset(resolveBrandAsset(kind, brand[field]))}
              alt={label}
              className="max-h-full max-w-full object-contain"
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{label}</div>
            <div className="truncate text-[10px] text-muted-foreground">
              {brand[field] ? "Custom image" : "Default artwork"}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void pickAsset(kind, field)}
            >
              Change
            </Button>
            {brand[field] && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void resetAsset(kind, field)}
              >
                Reset
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
