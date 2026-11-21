import { parsePlanItem, type ImageSlide, type PlanItem } from "@/types"
import { givingSlide } from "@/lib/giving-slide"
import { resolveBrandAsset } from "@/lib/brand"
import type { BrandConfig } from "@/stores/settings-store"
import { prayerImageSlide } from "./prayer-slide"

export function getPlanItemThumbnail(
  item: PlanItem,
  brand: Pick<
    BrandConfig,
    | "legacyEwc"
    | "momoImagePath"
    | "jesusImagePath"
    | "givingProvider"
    | "givingNumber"
    | "givingAccountName"
  >
): ImageSlide | null {
  const parsed = parsePlanItem(item)
  if (!parsed) return null
  if (parsed.type === "momo") return givingSlide(brand)
  if (parsed.type === "jesus") {
    return {
      url: resolveBrandAsset(parsed.type, brand.jesusImagePath),
      label: "Jesus",
    }
  }
  if (parsed.type !== "blank") return null
  if (parsed.prayer) return prayerImageSlide(item.id, parsed.prayer)
  if (!parsed.imageUrl) return null
  return {
    url: parsed.imageUrl,
    label: parsed.imageLabel ?? "Slide",
    ...(parsed.mediaType ? { mediaType: parsed.mediaType, poster: parsed.poster } : {}),
          ...(parsed.textOverlay ? { textOverlay: parsed.textOverlay } : {}),
  }
}
