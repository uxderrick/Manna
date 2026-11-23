import { YouTubePlayer } from "@/components/broadcast/youtube-player"
import { initializeChurchAssets, resolveChurchAsset } from "@/lib/church-assets"
import { getSpeakerPortraitUrl, SPEAKER_LOGO_MARK } from "@/lib/speaker-portrait"
import { drawImageSlide } from "@/lib/image-slide-renderer"
import { startLoopingVideo, drawVideoCover } from "@/lib/looping-video"
import { afterBroadcastPaint } from "@/lib/after-broadcast-paint"
import { info } from "@tauri-apps/plugin-log"
import { createRoot } from "react-dom/client"
import { useRef, useEffect, useCallback, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { listen, emit } from "@tauri-apps/api/event"
import { insetsToTransform, IDENTITY_INSETS, type CalibrationInsets } from "@/lib/projector-calibration"
import { renderVerse } from "@/lib/verse-renderer"
import { renderNotes } from "@/lib/notes-renderer"
import type { ImageSlide, BroadcastTheme, VerseRenderData, NotesSlide } from "@/types/broadcast"
import type { NdiConfigEventPayload, NdiFrameRequest } from "@/types"

/** Convert Uint8Array/Uint8ClampedArray to base64 using Function.apply (avoids spread stack overflow) */
function uint8ToBase64(bytes: Uint8Array | Uint8ClampedArray): string {
  const CHUNK = 0x8000 // 32KB — safe for Function.apply
  const parts: string[] = []
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(
      String.fromCharCode.apply(
        null,
        bytes.subarray(i, i + CHUNK) as unknown as number[],
      ),
    )
  }
  return btoa(parts.join(""))
}

/** Read output ID from URL query param (?output=main or ?output=alt). Defaults to "main". */
const OUTPUT_ID = new URLSearchParams(window.location.search).get("output") ?? "main"

function drawTickerAnnouncement(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  text: string,
  scrollOffset: number,
) {
  const bandHeight = Math.round(height * 0.085)
  const y = height - bandHeight

  // Translucent dark band — current slide content still visible above.
  ctx.fillStyle = "rgba(10, 12, 16, 0.82)"
  ctx.fillRect(0, y, width, bandHeight)

  // Subtle top border highlight
  ctx.fillStyle = "rgba(255, 255, 255, 0.08)"
  ctx.fillRect(0, y, width, 1)

  const fontSize = Math.round(bandHeight * 0.46)
  ctx.font = `500 ${fontSize}px "Inter Variable", system-ui, sans-serif`
  ctx.fillStyle = "#ffffff"
  ctx.textBaseline = "middle"
  ctx.textAlign = "left"

  // Marquee: draw twice for seamless wrap.
  const textWidth = ctx.measureText(text).width
  const gap = Math.round(width * 0.1)
  const totalCycle = textWidth + gap
  const x1 = width - (scrollOffset % totalCycle)
  ctx.fillText(text, x1, y + bandHeight / 2)
  ctx.fillText(text, x1 + totalCycle, y + bandHeight / 2)
}

function drawCalibrationOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  insets: { top: number; right: number; bottom: number; left: number },
) {
  const x = insets.left * width
  const y = insets.top * height
  const w = width * (1 - insets.left - insets.right)
  const h = height * (1 - insets.top - insets.bottom)

  ctx.save()
  ctx.fillStyle = "rgba(0,0,0,0.45)"
  ctx.fillRect(0, 0, width, y)
  ctx.fillRect(0, y + h, width, height - (y + h))
  ctx.fillRect(0, y, x, h)
  ctx.fillRect(x + w, y, width - (x + w), h)

  ctx.strokeStyle = "#22d3ee"
  ctx.lineWidth = Math.max(2, width * 0.002)
  ctx.strokeRect(x, y, w, h)

  ctx.strokeStyle = "rgba(34,211,238,0.35)"
  ctx.lineWidth = Math.max(1, width * 0.001)
  for (let i = 1; i < 3; i++) {
    const gx = x + (w * i) / 3
    ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx, y + h); ctx.stroke()
    const gy = y + (h * i) / 3
    ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); ctx.stroke()
  }

  const m = Math.min(w, h) * 0.06
  ctx.strokeStyle = "#22d3ee"
  ctx.lineWidth = Math.max(2, width * 0.003)
  const corners: Array<[number, number, number, number]> = [
    [x, y, m, m],
    [x + w, y, -m, m],
    [x, y + h, m, -m],
    [x + w, y + h, -m, -m],
  ]
  for (const [cx, cy, dx, dy] of corners) {
    ctx.beginPath(); ctx.moveTo(cx + dx, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dy); ctx.stroke()
  }

  const ccx = x + w / 2
  const ccy = y + h / 2
  const cross = Math.min(w, h) * 0.04
  ctx.beginPath()
  ctx.moveTo(ccx - cross, ccy); ctx.lineTo(ccx + cross, ccy)
  ctx.moveTo(ccx, ccy - cross); ctx.lineTo(ccx, ccy + cross)
  ctx.stroke()
  ctx.restore()
}

function drawSlideAnnouncement(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  text: string,
) {
  // Fully opaque background — takes over current slide content.
  ctx.fillStyle = "#000000"
  ctx.fillRect(0, 0, width, height)

  const padX = Math.round(width * 0.08)
  const maxWidth = width - padX * 2
  const baseSize = Math.round(height * 0.085)

  ctx.fillStyle = "#ffffff"
  ctx.textAlign = "left"
  ctx.textBaseline = "alphabetic"

  // Wrap text into lines; shrink font if too tall.
  let fontSize = baseSize
  let lines = wrapAnnouncement(ctx, text, maxWidth, fontSize)
  let lineHeight = Math.round(fontSize * 1.25)
  while (lines.length * lineHeight > height * 0.7 && fontSize > 24) {
    fontSize = Math.round(fontSize * 0.92)
    lines = wrapAnnouncement(ctx, text, maxWidth, fontSize)
    lineHeight = Math.round(fontSize * 1.25)
  }

  const blockHeight = lines.length * lineHeight
  let y = Math.round((height - blockHeight) / 2 + fontSize)
  for (const line of lines) {
    ctx.fillText(line, padX, y, maxWidth)
    y += lineHeight
  }
}

function wrapAnnouncement(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  fontSize: number,
): string[] {
  ctx.font = `600 ${fontSize}px "Inter Variable", system-ui, sans-serif`
  const out: string[] = []
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    let line = ""
    for (const word of words) {
      const test = line ? `${line} ${word}` : word
      if (ctx.measureText(test).width > maxWidth && line) {
        out.push(line)
        line = word
      } else {
        line = test
      }
    }
    if (line) out.push(line)
  }
  return out
}

interface BroadcastPayload {
  sentAt?: number
  hidden?: boolean
  theme: BroadcastTheme
  verse: VerseRenderData | null
  blankLogo?: boolean
  blankVideoUrl?: string | null
  blankLogoUrl?: string
  fullscreenImage?: ImageSlide | null
  notes?: NotesSlide | null
}

const BLANK_LOGO_URL = "/manna-logo.png"

interface AnnouncementPayload {
  text: string
  mode: "ticker" | "slide"
  duration: number | null
  paused?: boolean
}

export function BroadcastCanvas() {
  const [youtubeSlide, setYoutubeSlide] = useState<ImageSlide | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoLoopRef = useRef<ReturnType<typeof startLoopingVideo> | null>(null)
  const videoUrlRef = useRef<string | null>(null)
  const latestData = useRef<BroadcastPayload | null>(null)
  const announcementRef = useRef<AnnouncementPayload | null>(null)
  const announcementTimerRef = useRef<number | null>(null)
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map())
  const ndiConfigRef = useRef<NdiConfigEventPayload>({
    active: false,
    fps: 24,
    width: 1920,
    height: 1080,
  })
  const ndiCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const lastPushRef = useRef(0)
  const pushingRef = useRef(false)
  const cancelAfterPaintRef = useRef<(() => void) | null>(null)

  const logDebug = useCallback((message: string, meta?: unknown) => {
    if (!import.meta.env.DEV) return
    if (meta === undefined) {
      console.debug(`[broadcast-output] ${message}`)
      return
    }
    console.debug(`[broadcast-output] ${message}`, meta)
  }, [])

  const tickerOffsetRef = useRef(0)
  const tickerRafRef = useRef<number | null>(null)

  const calibrationRef = useRef<CalibrationInsets>(IDENTITY_INSETS)
  const calibrationEditingRef = useRef(false)

  /** Paint the current `data + announcement` frame onto an arbitrary ctx. */
  const renderFrame = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      const data = latestData.current
      if (!data || data.hidden) {
        ctx.fillStyle = "#000"
        ctx.fillRect(0, 0, width, height)
        return
      }
      const { theme, verse, blankLogo, blankLogoUrl, fullscreenImage, notes } = data
      const logoUrl = blankLogoUrl || BLANK_LOGO_URL
      const announcement = announcementRef.current

      if (announcement && announcement.mode === "slide") {
        drawSlideAnnouncement(ctx, width, height, announcement.text)
        return
      }

      if (fullscreenImage) {
        drawImageSlide(ctx, fullscreenImage.mediaType === "youtube" ? undefined : imageCacheRef.current.get(fullscreenImage.mediaType ? fullscreenImage.poster ?? "" : fullscreenImage.url), fullscreenImage, width, height, imageCacheRef.current.get(getSpeakerPortraitUrl(fullscreenImage) ?? ""), imageCacheRef.current.get(SPEAKER_LOGO_MARK), videoLoopRef.current?.video)
        if (announcement && announcement.mode === "ticker") {
          drawTickerAnnouncement(ctx, width, height, announcement.text, tickerOffsetRef.current)
        }
        return
      }

      if (notes) {
        renderNotes(ctx, theme, notes, width, height)
        if (announcement && announcement.mode === "ticker") {
          drawTickerAnnouncement(ctx, width, height, announcement.text, tickerOffsetRef.current)
        }
        return
      }

      if (blankLogo) {
        ctx.fillStyle = "#000"
        ctx.fillRect(0, 0, width, height)
        if (drawVideoCover(ctx, videoLoopRef.current?.video ?? null, width, height)) {
          if (announcement?.mode === "ticker") drawTickerAnnouncement(ctx, width, height, announcement.text, tickerOffsetRef.current)
          return
        }
        const img = imageCacheRef.current.get(logoUrl)
        if (img && img.complete && img.naturalWidth > 0) {
          const target = Math.min(width, height) * 0.99
          const aspect = img.naturalWidth / img.naturalHeight
          const logoW = aspect >= 1 ? target : target * aspect
          const logoH = aspect >= 1 ? target / aspect : target
          ctx.drawImage(img, (width - logoW) / 2, (height - logoH) / 2, logoW, logoH)
        }
        if (announcement && announcement.mode === "ticker") {
          drawTickerAnnouncement(ctx, width, height, announcement.text, tickerOffsetRef.current)
        }
        return
      }

      const result = renderVerse(ctx, theme, verse, {
        scale: 1,
        imageCache: imageCacheRef.current,
        backgroundVideo: videoLoopRef.current?.video,
      })
      if (!result) {
        ctx.fillStyle = "#000"
        ctx.fillRect(0, 0, width, height)
        logDebug("renderVerse returned null; drew fallback frame")
      }
      if (announcement && announcement.mode === "ticker") {
        drawTickerAnnouncement(ctx, width, height, announcement.text, tickerOffsetRef.current)
      }
    },
    [logDebug],
  )

  const applyCalibrationTransform = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const fw = canvas.width || 1920
    const fh = canvas.height || 1080
    const t = insetsToTransform(calibrationRef.current, fw, fh)
    const fx = (t.offsetX / fw) * 100
    const fy = (t.offsetY / fh) * 100
    canvas.style.transformOrigin = "0 0"
    canvas.style.transform = `translate(${fx}%, ${fy}%) scale(${t.scale})`
  }, [])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const data = latestData.current
    if (data) {
      if (canvas.width !== data.theme.resolution.width) canvas.width = data.theme.resolution.width
      if (canvas.height !== data.theme.resolution.height) canvas.height = data.theme.resolution.height
    }
    renderFrame(ctx, canvas.width, canvas.height)
    if (calibrationEditingRef.current) {
      drawCalibrationOverlay(ctx, canvas.width, canvas.height, calibrationRef.current)
    }
    applyCalibrationTransform()
  }, [renderFrame, applyCalibrationTransform])

  // Drive the ticker animation. Re-renders only while a ticker is active so
  // we don't burn CPU during normal verse display.
  useEffect(() => {
    const loop = () => {
      const a = announcementRef.current
      if (a && a.mode === "ticker") {
        if (!a.paused) tickerOffsetRef.current += 2
        draw()
        tickerRafRef.current = requestAnimationFrame(loop)
      } else {
        tickerRafRef.current = null
      }
    }
    const start = () => {
      if (tickerRafRef.current == null) tickerRafRef.current = requestAnimationFrame(loop)
    }
    const id = window.setInterval(() => {
      const a = announcementRef.current
      if (a && a.mode === "ticker") start()
    }, 250)
    return () => {
      window.clearInterval(id)
      if (tickerRafRef.current != null) cancelAnimationFrame(tickerRafRef.current)
      tickerRafRef.current = null
    }
  }, [draw])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    void listen<{ insets: CalibrationInsets; editing: boolean }>(
      "projector:calibration",
      (event) => {
        calibrationRef.current = event.payload.insets ?? IDENTITY_INSETS
        calibrationEditingRef.current = !!event.payload.editing
        applyCalibrationTransform()
        draw()
      },
    ).then((fn) => { unlisten = fn })
    return () => { unlisten?.() }
  }, [applyCalibrationTransform, draw])

  const preloadImage = useCallback((url: string, label: string) => {
    const cache = imageCacheRef.current
    if (cache.has(url)) return
    const img = new Image()
    img.onload = () => {
      cache.set(url, img)
      logDebug(`${label} loaded`, { url })
      draw()
    }
    img.onerror = () => {
      cache.delete(url)
      console.warn(`[broadcast-output] failed to load ${label}`, { url })
    }
    cache.set(url, img)
    img.src = resolveChurchAsset(url)
  }, [draw, logDebug])

  const preloadBackgroundImage = useCallback((theme: BroadcastTheme) => {
    const bg = theme.background
    if (bg.type === "video" && bg.video?.poster) preloadImage(bg.video.poster, "Video poster")
    if (bg.type === "image" && bg.image?.url) preloadImage(bg.image.url, "Background image")
    if (theme.logo?.url) preloadImage(theme.logo.url, "Logo")
  }, [preloadImage])

  const warmTheme = useCallback((theme: BroadcastTheme) => {
    preloadBackgroundImage(theme)
    void Promise.all([theme.verseText, theme.reference].map((text) =>
      document.fonts.load(`${text.fontWeight} 16px "${text.fontFamily}"`)
    )).then(draw).catch((error) => console.warn("[broadcast-output] font load failed", error))
  }, [draw, preloadBackgroundImage])

  const pushNdiFrame = useCallback(async () => {
    if (!ndiConfigRef.current.active) return
    if (pushingRef.current) return // back-pressure: skip if already pushing
    pushingRef.current = true

    try {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext("2d")
      if (!ctx) return

      const targetWidth = ndiConfigRef.current.width
      const targetHeight = ndiConfigRef.current.height

      let sourceCtx = ctx
      let sourceWidth = canvas.width
      let sourceHeight = canvas.height

      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        const ndiCanvas = ndiCanvasRef.current ?? document.createElement("canvas")
        ndiCanvas.width = targetWidth
        ndiCanvas.height = targetHeight
        const ndiCtx = ndiCanvas.getContext("2d")
        if (!ndiCtx) return
        ndiCtx.drawImage(canvas, 0, 0, targetWidth, targetHeight)
        ndiCanvasRef.current = ndiCanvas
        sourceCtx = ndiCtx
        sourceWidth = targetWidth
        sourceHeight = targetHeight
      }

      const imageData = sourceCtx.getImageData(0, 0, sourceWidth, sourceHeight)
      const rgbaBase64 = uint8ToBase64(imageData.data)

      const request: NdiFrameRequest = {
        outputId: OUTPUT_ID,
        width: sourceWidth,
        height: sourceHeight,
        rgbaBase64,
      }

      await invoke("push_ndi_frame", { request })
      lastPushRef.current = Date.now()
    } catch (error) {
      console.warn("[broadcast-output] push_ndi_frame failed", error)
    } finally {
      pushingRef.current = false
    }
  }, [])

  /** Push a burst of 3 frames after content changes (NDI receivers need a few frames to sync) */
  const pushNdiBurst = useCallback(() => {
    void pushNdiFrame()
    setTimeout(() => void pushNdiFrame(), 150)
    setTimeout(() => void pushNdiFrame(), 300)
  }, [pushNdiFrame])

  const syncYouTube = useCallback(() => {
    const data = latestData.current
    const slide = data?.fullscreenImage
    if (!data || data.hidden || announcementRef.current || slide?.mediaType !== "youtube") {
      setYoutubeSlide(null)
      return
    }
    if (ndiConfigRef.current.active) {
      setYoutubeSlide(null)
      if (OUTPUT_ID === "main") {
        void emit("broadcast:youtube-status", {
          url: slide.url,
          state: "error",
          message: "YouTube needs HDMI or a projector output. Stop NDI before playing it.",
        }).catch(() => {})
      }
      return
    }
    setYoutubeSlide((current) =>
      current?.url === slide.url && current.playbackId === slide.playbackId && current.volume === slide.volume ? current : slide
    )
  }, [])

  const syncVideo = useCallback(() => {
    const data = latestData.current
    const canPlay = data && !data.hidden && !data.notes && announcementRef.current?.mode !== "slide"
    const url = !canPlay
      ? null
      : data.fullscreenImage
        ? data.fullscreenImage.mediaType === "video" ? data.fullscreenImage.url : null
      : data.blankLogo
        ? data.blankVideoUrl ?? null
        : data.theme.background.type === "video"
          ? data.theme.background.video?.url ?? null
          : null
    if (url === videoUrlRef.current) return
    videoLoopRef.current?.stop()
    videoLoopRef.current = null
    videoUrlRef.current = url
    if (url) videoLoopRef.current = startLoopingVideo(url, () => {
      draw()
      if (ndiConfigRef.current.active && Date.now() - lastPushRef.current >= 1000 / ndiConfigRef.current.fps) void pushNdiFrame()
    }, draw)
  }, [draw, pushNdiFrame])

  useEffect(() => {
    // Set initial canvas size
    const canvas = canvasRef.current
    if (canvas) {
      canvas.width = 1920
      canvas.height = 1080
      const ctx = canvas.getContext("2d")
      if (ctx) {
        ctx.fillStyle = "#000"
        ctx.fillRect(0, 0, 1920, 1080)
      }
    }

    const currentWindow = getCurrentWebviewWindow()
    logDebug("Listener registration started", { label: currentWindow.label })
    const unlistenPreload = currentWindow.listen<{ theme: BroadcastTheme }>(`broadcast:preload:${OUTPUT_ID}`, (event) => {
      warmTheme(event.payload.theme)
    })
    const unlisten = currentWindow.listen<BroadcastPayload>(`broadcast:verse-update:${OUTPUT_ID}`, (event) => {
      const receivedAt = Date.now()
      const renderStarted = performance.now()
      latestData.current = event.payload
      syncVideo()
      syncYouTube()
      warmTheme(event.payload.theme)
      if (event.payload.blankLogo) {
        preloadImage(event.payload.blankLogoUrl || BLANK_LOGO_URL, "Blank logo")
      }
      const slide = event.payload.fullscreenImage
      const poster = slide?.mediaType === "youtube" ? undefined : slide?.mediaType ? slide.poster : slide?.url
      if (poster) preloadImage(poster, "Fullscreen media poster")
      const portraitUrl = getSpeakerPortraitUrl(event.payload.fullscreenImage)
      if (portraitUrl) {
        preloadImage(portraitUrl, "Speaker portrait")
        preloadImage(SPEAKER_LOGO_MARK, "EWC mark")
      }
      logDebug("Received broadcast:verse-update", {
        hasVerse: Boolean(event.payload.verse),
        blankLogo: Boolean(event.payload.blankLogo),
        themeId: event.payload.theme.id,
      })
      draw()
      const drawMs = Math.round(performance.now() - renderStarted)
      cancelAfterPaintRef.current?.()
      cancelAfterPaintRef.current = afterBroadcastPaint(() => {
        if (event.payload.sentAt != null) {
          const pendingImages = [...imageCacheRef.current.values()].filter((image) => !image.complete).length
          void info(`[BROADCAST-TIMING] output=${OUTPUT_ID} transport_ms=${receivedAt - event.payload.sentAt} draw_ms=${drawMs} paint_opportunity_ms=${Date.now() - event.payload.sentAt} pending_images=${pendingImages}`)
            .catch(() => {})
        }
        pushNdiBurst()
      })
    })

    const unlistenAnnouncement = currentWindow.listen<AnnouncementPayload | null>(`broadcast:announcement:${OUTPUT_ID}`, (event) => {
      announcementRef.current = event.payload
      syncVideo()
      syncYouTube()
      tickerOffsetRef.current = 0
      if (announcementTimerRef.current !== null) {
        clearTimeout(announcementTimerRef.current)
        announcementTimerRef.current = null
      }
      if (event.payload && event.payload.duration) {
        announcementTimerRef.current = window.setTimeout(() => {
          announcementRef.current = null
          syncVideo()
          syncYouTube()
          announcementTimerRef.current = null
          draw()
          pushNdiBurst()
        }, event.payload.duration * 1000)
      }
      logDebug("Received broadcast:announcement", event.payload)
      draw()
      pushNdiBurst()
    })

    const unlistenNdiConfig = currentWindow.listen<NdiConfigEventPayload>(`broadcast:ndi-config:${OUTPUT_ID}`, (event) => {
      ndiConfigRef.current = event.payload
      syncYouTube()
      logDebug("Received broadcast:ndi-config", event.payload)
      // Push burst when NDI becomes active
      if (event.payload.active) pushNdiBurst()
    })

    // Request current NDI status on mount (fixes race condition
    // where NDI is started before this window opens)
    void invoke<{ active: boolean; width: number; height: number; fps: number } | null>("get_ndi_status", { outputId: OUTPUT_ID })
      .then((status) => {
        if (status && status.active) {
          ndiConfigRef.current = {
            active: true,
            fps: status.fps,
            width: status.width,
            height: status.height,
          }
          syncYouTube()
          logDebug("Fetched NDI status on mount", status)
        }
      })
      .catch(() => {
        // Command may not exist yet
      })

    void currentWindow.emitTo("main", "broadcast:output-ready").then(() => {
      logDebug("Sent broadcast:output-ready")
    }).catch(() => {
      console.warn("[broadcast-output] failed to send output-ready event")
    })

    return () => {
      videoLoopRef.current?.stop()
      videoLoopRef.current = null
      videoUrlRef.current = null
      cancelAfterPaintRef.current?.()
      unlisten.then((fn) => fn())
      unlistenPreload.then((fn) => fn())
      unlistenAnnouncement.then((fn) => fn())
      unlistenNdiConfig.then((fn) => fn())
      if (announcementTimerRef.current !== null) {
        clearTimeout(announcementTimerRef.current)
      }
    }
  }, [draw, logDebug, warmTheme, preloadImage, pushNdiFrame, pushNdiBurst, syncVideo, syncYouTube])

  // Slow keepalive: push one frame every 2s if idle (prevents NDI receivers from dropping the source)
  useEffect(() => {
    const timer = setInterval(() => {
      if (!ndiConfigRef.current.active) return
      const elapsed = Date.now() - lastPushRef.current
      if (elapsed > 2000) void pushNdiFrame()
    }, 2000)
    return () => clearInterval(timer)
  }, [pushNdiFrame])

  // Fullscreen: F / F11 toggles, Esc exits. Also double-click on canvas.
  useEffect(() => {
    const win = getCurrentWebviewWindow()
    const toggle = async () => {
      try {
        const isFs = await win.isFullscreen()
        await win.setFullscreen(!isFs)
      } catch (e) {
        console.warn("[broadcast] fullscreen toggle failed", e)
      }
    }
    const exit = async () => {
      try {
        if (await win.isFullscreen()) await win.setFullscreen(false)
      } catch (e) {
        console.warn("[broadcast] fullscreen exit failed", e)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "f" || e.key === "F" || e.key === "F11") {
        e.preventDefault()
        void toggle()
      } else if (e.key === "Escape") {
        void exit()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const handleDoubleClick = useCallback(async () => {
    const win = getCurrentWebviewWindow()
    try {
      const isFs = await win.isFullscreen()
      await win.setFullscreen(!isFs)
    } catch (e) {
      console.warn("[broadcast] fullscreen toggle failed", e)
    }
  }, [])

  return (
    <>
      <canvas
      ref={canvasRef}
      onDoubleClick={handleDoubleClick}
      style={{
        width: "100vw",
        height: "100vh",
        display: "block",
        objectFit: "contain",
      }}
    />
      {youtubeSlide && (
        <YouTubePlayer
          key={youtubeSlide.playbackId ?? youtubeSlide.url}
          url={youtubeSlide.url}
          muted={OUTPUT_ID !== "main"}
          volume={youtubeSlide.volume ?? 100}
        />
      )}
    </>
  )
}

const root = document.getElementById("broadcast-root")!
if (root) void initializeChurchAssets().then(() => createRoot(root).render(<BroadcastCanvas />))
