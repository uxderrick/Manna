import { hasChurchAsset } from "./church-assets"
import type { ImageSlide } from "@/types"

export const SPEAKER_LOGO_MARK = "/EWC-White.png"
export const DEFAULT_SPEAKER_NAME = "Pastor John Kennedy"
export const DEFAULT_SPEAKER_PORTRAIT =
  "/service-slides/pastor-john-kennedy-starburst.png"

export function getSpeakerPortraitUrl(slide: ImageSlide | null | undefined) {
  const overlay = slide?.textOverlay
  return hasChurchAsset(DEFAULT_SPEAKER_PORTRAIT) &&
    overlay?.layout === "title" &&
    overlay.body.trim().replace(/\s+/g, " ").toLowerCase() ===
      DEFAULT_SPEAKER_NAME.toLowerCase()
    ? DEFAULT_SPEAKER_PORTRAIT
    : undefined
}
