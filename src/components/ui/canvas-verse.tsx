import { resolveChurchAsset } from "@/lib/church-assets"
import {
  getSpeakerPortraitUrl,
  SPEAKER_LOGO_MARK,
} from "@/lib/speaker-portrait"
import { drawImageSlide } from "@/lib/image-slide-renderer"
import { startLoopingVideo, drawVideoCover } from "@/lib/looping-video"
import { useRef, useEffect, useState, memo } from "react"
import { renderVerse, type VerseLayoutMetrics } from "@/lib/verse-renderer"
import type { ImageSlide, BroadcastTheme, VerseRenderData } from "@/types"
import { cn } from "@/lib/utils"
import { renderAndReport } from "@/lib/canvas-render-result"

const imageUsers = new Map<string, number>()
const sharedImageCache = new Map<string, HTMLImageElement>()
const pendingImageLoads = new Map<string, Promise<HTMLImageElement>>()

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`))
    img.src = resolveChurchAsset(url)
  })
}

function ensureImage(url: string, onReady?: () => void) {
  if (sharedImageCache.has(url)) return
  const pending = pendingImageLoads.get(url)
  if (pending) {
    void pending.then(() => onReady?.()).catch(() => {})
    return
  }
  const req = loadImage(url)
    .then((img) => {
      if ((imageUsers.get(url) ?? 0) > 0) sharedImageCache.set(url, img)
      onReady?.()
      return img
    })
    .finally(() => pendingImageLoads.delete(url))
  pendingImageLoads.set(url, req)
  void req.catch(() => console.warn("[canvas] Could not load image"))
}

interface CanvasVerseProps {
  theme: BroadcastTheme
  verse: VerseRenderData | null
  fullscreenImage?: ImageSlide | null
  blankLogo?: boolean
  blankLogoLabel?: string
  blankVideoUrl?: string | null
  blankLogoUrl?: string
  className?: string
  onRenderResult?: (result: VerseLayoutMetrics | null) => void
}

export const CanvasVerse = memo(function CanvasVerse({
  theme,
  verse,
  fullscreenImage = null,
  blankLogo = false,
  blankVideoUrl = null,
  blankLogoLabel = "Manna",
  blankLogoUrl = "/manna-logo.png",
  className,
  onRenderResult,
}: CanvasVerseProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoLoopRef = useRef<ReturnType<typeof startLoopingVideo> | null>(null)
  const paintRef = useRef<(() => void) | null>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const videoUrl = fullscreenImage
    ? fullscreenImage.mediaType === "video" ? fullscreenImage.url : null
    : blankLogo
      ? blankVideoUrl
      : theme.background.type === "video"
        ? theme.background.video?.url ?? null
        : null

  // Measure container width with ResizeObserver
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      if (w > 0) setContainerWidth(w)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // Render to canvas at display size
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || containerWidth === 0) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const aspectRatio = theme.resolution.width / theme.resolution.height
    const displayW = containerWidth
    const displayH = displayW / aspectRatio

    canvas.width = displayW * dpr
    canvas.height = displayH * dpr
    canvas.style.width = `${displayW}px`
    canvas.style.height = `${displayH}px`

    ctx.scale(dpr, dpr)
    const scale = displayW / theme.resolution.width

    const drawFullscreenImage = (
      cx: CanvasRenderingContext2D,
      w: number,
      h: number
    ) => {
      if (!fullscreenImage) return
      drawImageSlide(
        cx,
        sharedImageCache.get(fullscreenImage.mediaType ? fullscreenImage.poster ?? "" : fullscreenImage.url),
        fullscreenImage,
        w,
        h,
        sharedImageCache.get(getSpeakerPortraitUrl(fullscreenImage) ?? ""),
        sharedImageCache.get(SPEAKER_LOGO_MARK),
        videoLoopRef.current?.video
      )
    }

    const usedImages = new Set(
      [
        theme.background.type === "image"
          ? theme.background.image?.url
          : undefined,
        theme.logo?.url,
        theme.background.type === "video" ? theme.background.video?.poster : undefined,
        fullscreenImage?.mediaType ? fullscreenImage.poster : fullscreenImage?.url,
        getSpeakerPortraitUrl(fullscreenImage),
        getSpeakerPortraitUrl(fullscreenImage) ? SPEAKER_LOGO_MARK : undefined,
        blankLogo ? blankLogoUrl : undefined,
      ].filter((url): url is string => Boolean(url))
    )
    usedImages.forEach((url) =>
      imageUsers.set(url, (imageUsers.get(url) ?? 0) + 1)
    )
    let active = true

    const drawBlankLogo = (
      cx: CanvasRenderingContext2D,
      w: number,
      h: number
    ) => {
      cx.fillStyle = "#000"
      cx.fillRect(0, 0, w, h)
      if (drawVideoCover(cx, videoLoopRef.current?.video ?? null, w, h)) return
      const img = sharedImageCache.get(blankLogoUrl)
      if (img && img.complete && img.naturalWidth > 0) {
        const target = Math.min(w, h) * 0.99
        const aspect = img.naturalWidth / img.naturalHeight
        const logoW = aspect >= 1 ? target : target * aspect
        const logoH = aspect >= 1 ? target / aspect : target
        cx.drawImage(img, (w - logoW) / 2, (h - logoH) / 2, logoW, logoH)
      }
    }

    const rerender = () => {
      if (!active) return
      const c = canvasRef.current
      const cx = c?.getContext("2d")
      if (!c || !cx) return
      cx.setTransform(1, 0, 0, 1, 0, 0)
      cx.clearRect(0, 0, c.width, c.height)
      cx.scale(dpr, dpr)
      if (fullscreenImage) {
        onRenderResult?.(null)
        drawFullscreenImage(
          cx,
          theme.resolution.width * scale,
          theme.resolution.height * scale
        )
        return
      }
      if (blankLogo) {
        onRenderResult?.(null)
        drawBlankLogo(
          cx,
          theme.resolution.width * scale,
          theme.resolution.height * scale
        )
        return
      }
      renderAndReport(
        () =>
          renderVerse(cx, theme, verse, {
            scale,
            imageCache: sharedImageCache,
            backgroundVideo: videoLoopRef.current?.video,
            collectWordHits: Boolean(onRenderResult),
          }),
        onRenderResult
      )
    }

    void Promise.all([
      document.fonts.load(
        `${theme.verseText.fontWeight} 16px "${theme.verseText.fontFamily}"`
      ),
      document.fonts.load(
        `${theme.reference.fontWeight} 16px "${theme.reference.fontFamily}"`
      ),
    ])
      .then(rerender)
      .catch(() => {})

    paintRef.current = rerender

    if (theme.background.type === "image" && theme.background.image?.url) {
      ensureImage(theme.background.image.url, rerender)
    }
    if (theme.background.type === "video" && theme.background.video?.poster) {
      ensureImage(theme.background.video.poster, rerender)
    }
    if (theme.logo?.url) {
      ensureImage(theme.logo.url, rerender)
    }
    if (fullscreenImage?.url) {
      const poster = fullscreenImage.mediaType ? fullscreenImage.poster : fullscreenImage.url
      if (poster) ensureImage(poster, rerender)
      const portraitUrl = getSpeakerPortraitUrl(fullscreenImage)
      if (portraitUrl) {
        ensureImage(portraitUrl, rerender)
        ensureImage(SPEAKER_LOGO_MARK, rerender)
      }
    }
    if (blankLogo) {
      ensureImage(blankLogoUrl, rerender)
    }

    if (fullscreenImage) {
      onRenderResult?.(null)
      drawFullscreenImage(
        ctx,
        theme.resolution.width * scale,
        theme.resolution.height * scale
      )
    } else if (blankLogo) {
      onRenderResult?.(null)
      drawBlankLogo(
        ctx,
        theme.resolution.width * scale,
        theme.resolution.height * scale
      )
    } else {
      renderAndReport(
        () =>
          renderVerse(ctx, theme, verse, {
            scale,
            imageCache: sharedImageCache,
            backgroundVideo: videoLoopRef.current?.video,
            collectWordHits: Boolean(onRenderResult),
          }),
        onRenderResult
      )
    }
    return () => {
      active = false
      paintRef.current = null
      usedImages.forEach((url) => {
        const users = (imageUsers.get(url) ?? 1) - 1
        if (users > 0) imageUsers.set(url, users)
        else {
          imageUsers.delete(url)
          sharedImageCache.delete(url)
        }
      })
    }
  }, [
    theme,
    verse,
    fullscreenImage,
    blankLogo,
    blankLogoLabel,
    blankLogoUrl,
    blankVideoUrl,
    containerWidth,
    onRenderResult,
  ])

  // Text changes replace the paint callback, while the same video keeps playing.
  useEffect(() => {
    if (!videoUrl) return
    const paint = () => paintRef.current?.()
    const loop = startLoopingVideo(videoUrl, paint, paint)
    videoLoopRef.current = loop
    return () => {
      loop.stop()
      videoLoopRef.current = null
    }
  }, [videoUrl])

  return (
    <div ref={containerRef} className={cn("w-full", className)}>
      <canvas ref={canvasRef} className="w-full rounded-md" />
    </div>
  )
})
