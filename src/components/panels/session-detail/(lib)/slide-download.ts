import { resolveChurchAsset } from "@/lib/church-assets"
import type { ImageSlide } from "@/types"
import { drawImageSlide } from "@/lib/image-slide-renderer"
import {
  getSpeakerPortraitUrl,
  SPEAKER_LOGO_MARK,
} from "@/lib/speaker-portrait"
import { buildSessionExportSlug } from "@/lib/session-export"
import { saveBinaryExport } from "./save-export"

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = "anonymous"
    const timer = setTimeout(() => {
      image.onload = null
      image.onerror = null
      reject(new Error("The slide image took too long to load. Try again."))
    }, 15000)
    image.onload = () => {
      clearTimeout(timer)
      resolve(image)
    }
    image.onerror = () => {
      clearTimeout(timer)
      reject(new Error("The saved slide image could not be loaded."))
    }
    image.src = resolveChurchAsset(url)
  })
}

/** Keep downloads full resolution; use a smaller JPEG for website artwork. */
async function renderSlide(
  slide: ImageSlide,
  format: "image/png" | "image/jpeg"
): Promise<Uint8Array> {
  const portraitUrl = getSpeakerPortraitUrl(slide)
  const [image, portrait, logo] = await Promise.all([
    loadImage(slide.url),
    portraitUrl ? loadImage(portraitUrl) : undefined,
    portraitUrl ? loadImage(SPEAKER_LOGO_MARK) : undefined,
    document.fonts.load('700 48px "Inter Variable"'),
    document.fonts.load('600 48px "Inter Variable"'),
    document.fonts.load('400 48px "Inter Variable"'),
  ])
  const canvas = document.createElement("canvas")
  canvas.width = format === "image/jpeg" ? 1280 : 1920
  canvas.height = format === "image/jpeg" ? 720 : 1080
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Could not prepare the slide image.")
  drawImageSlide(ctx, image, slide, canvas.width, canvas.height, portrait, logo)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) =>
        value
          ? resolve(value)
          : reject(new Error("Could not export the slide image.")),
      format,
      format === "image/jpeg" ? 0.74 : undefined
    )
  })
  return new Uint8Array(await blob.arrayBuffer())
}

export function renderSlidePng(slide: ImageSlide) {
  return renderSlide(slide, "image/png")
}
export function renderSlideJpeg(slide: ImageSlide) {
  return renderSlide(slide, "image/jpeg")
}

export async function downloadSessionSlide(
  slide: ImageSlide,
  title: string,
  key: string
) {
  const png = await renderSlidePng(slide)
  return saveBinaryExport(png, `${buildSessionExportSlug(title)}-${key}.png`, {
    name: "PNG image",
    extensions: ["png"],
  })
}
