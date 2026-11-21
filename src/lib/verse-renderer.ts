import { backgroundWithEffects } from "./background-effects"
import { drawVideoCover } from "./looping-video"
import {
  numberedVerseLines,
  measureVerseWords,
  numberedWordFont,
} from "./numbered-verse-layout"
import type {
  BroadcastTheme,
  VerseRenderData,
  RenderOptions,
  WordHitBox,
} from "@/types/broadcast"
import { opaqueTextColor } from "@/lib/opaque-text-color"
import { validHighlights } from "@/lib/text-highlights"

export interface VerseLayoutRect {
  x: number
  y: number
  width: number
  height: number
}

export interface HighlightLayoutRect extends VerseLayoutRect {
  color: string
}

export interface VerseLayoutMetrics {
  scaledTheme: BroadcastTheme
  contentOverflows?: boolean
  textAreaRect: VerseLayoutRect
  textRect: VerseLayoutRect
  referenceRect: VerseLayoutRect | null
  verseRect: VerseLayoutRect | null
  wordHits: WordHitBox[]
  highlightRects: HighlightLayoutRect[]
}

export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const out: string[] = []

  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      out.push("")
      continue
    }
    let currentLine = ""
    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word
      const metrics = ctx.measureText(testLine)
      if (metrics.width > maxWidth && currentLine) {
        out.push(currentLine)
        currentLine = word
      } else {
        currentLine = testLine
      }
    }
    if (currentLine) out.push(currentLine)
  }

  return out
}

function alignX(
  textAlign: "left" | "center" | "right",
  rectX: number,
  rectWidth: number
): number {
  switch (textAlign) {
    case "left":
      return rectX
    case "center":
      return rectX + rectWidth / 2
    case "right":
      return rectX + rectWidth
  }
}

function alignY(
  verticalAlign: "top" | "middle" | "bottom",
  rectY: number,
  rectHeight: number,
  contentHeight: number
): number {
  switch (verticalAlign) {
    case "middle":
      return rectY + (rectHeight - contentHeight) / 2
    case "bottom":
      return rectY + rectHeight - contentHeight
    case "top":
    default:
      return rectY
  }
}

function resolveHorizontalAlign(
  value:
    | BroadcastTheme["verseText"]["horizontalAlign"]
    | BroadcastTheme["reference"]["horizontalAlign"]
    | undefined,
  fallback: BroadcastTheme["layout"]["textAlign"],
  allowJustify: boolean
): "left" | "center" | "right" | "justify" {
  if (!value) return fallback
  if (value === "justify" && !allowJustify) return fallback
  return value
}

function resolveVerticalAlign(
  value:
    | BroadcastTheme["verseText"]["verticalAlign"]
    | BroadcastTheme["reference"]["verticalAlign"]
    | undefined
): "top" | "middle" | "bottom" {
  return value ?? "top"
}

function resolveTextTransform(
  value:
    | BroadcastTheme["verseText"]["textTransform"]
    | BroadcastTheme["reference"]["textTransform"]
    | undefined
): "none" | "uppercase" | "lowercase" | "capitalize" {
  return value ?? "none"
}

function resolveTextDecoration(
  value:
    | BroadcastTheme["verseText"]["textDecoration"]
    | BroadcastTheme["reference"]["textDecoration"]
    | undefined
): "none" | "underline" | "line-through" {
  return value ?? "none"
}

function applyTextTransform(
  text: string,
  transform: "none" | "uppercase" | "lowercase" | "capitalize"
): string {
  switch (transform) {
    case "uppercase":
      return text.toUpperCase()
    case "lowercase":
      return text.toLowerCase()
    case "capitalize":
      return text.replace(/\b\w/g, (char) => char.toUpperCase())
    case "none":
    default:
      return text
  }
}

function drawTextDecorationLine(
  ctx: CanvasRenderingContext2D,
  decoration: "none" | "underline" | "line-through",
  color: string,
  align: "left" | "center" | "right" | "justify",
  x: number,
  y: number,
  width: number,
  fontSize: number,
  fallbackLeftX?: number
): void {
  if (decoration === "none" || width <= 0) return
  const startX =
    align === "left"
      ? x
      : align === "center"
        ? x - width / 2
        : align === "right"
          ? x - width
          : (fallbackLeftX ?? x)
  const lineY =
    decoration === "underline" ? y + fontSize * 0.92 : y + fontSize * 0.52
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(1, fontSize * 0.06)
  ctx.beginPath()
  ctx.moveTo(startX, lineY)
  ctx.lineTo(startX + width, lineY)
  ctx.stroke()
  ctx.restore()
}

function anchorPosition(
  anchor: BroadcastTheme["layout"]["anchor"],
  areaWidth: number,
  areaHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  offsetX: number,
  offsetY: number
): { x: number; y: number } {
  let x: number
  let y: number

  switch (anchor) {
    case "top-left":
      x = 0
      y = 0
      break
    case "top-center":
      x = (canvasWidth - areaWidth) / 2
      y = 0
      break
    case "top-right":
      x = canvasWidth - areaWidth
      y = 0
      break
    case "center-left":
      x = 0
      y = (canvasHeight - areaHeight) / 2
      break
    case "center":
      x = (canvasWidth - areaWidth) / 2
      y = (canvasHeight - areaHeight) / 2
      break
    case "center-right":
      x = canvasWidth - areaWidth
      y = (canvasHeight - areaHeight) / 2
      break
    case "bottom-left":
      x = 0
      y = canvasHeight - areaHeight
      break
    case "bottom-center":
      x = (canvasWidth - areaWidth) / 2
      y = canvasHeight - areaHeight
      break
    case "bottom-right":
      x = canvasWidth - areaWidth
      y = canvasHeight - areaHeight
      break
  }

  return { x: x + offsetX, y: y + offsetY }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  radius = Math.max(0, Math.min(radius, width / 2, height / 2))
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + width - radius, y)
  ctx.arcTo(x + width, y, x + width, y + radius, radius)
  ctx.lineTo(x + width, y + height - radius)
  ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius)
  ctx.lineTo(x + radius, y + height)
  ctx.arcTo(x, y + height, x, y + height - radius, radius)
  ctx.lineTo(x, y + radius)
  ctx.arcTo(x, y, x + radius, y, radius)
  ctx.closePath()
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  theme: BroadcastTheme,
  imageCache?: Map<string, HTMLImageElement>,
  video?: HTMLVideoElement | null
): void {
  const { width, height } = theme.resolution
  const bg = theme.background

  switch (bg.type) {
    case "video": {
      ctx.fillStyle = "#000000"
      ctx.fillRect(0, 0, width, height)
      if (!drawVideoCover(ctx, video ?? null, width, height)) {
        const poster = imageCache?.get(bg.video?.poster ?? "")
        if (poster?.complete && poster.naturalWidth > 0) {
          const scale = Math.max(width / poster.naturalWidth, height / poster.naturalHeight)
          const w = poster.naturalWidth * scale
          const h = poster.naturalHeight * scale
          ctx.drawImage(poster, (width - w) / 2, (height - h) / 2, w, h)
        }
      }
      ctx.fillStyle = `rgba(0, 0, 0, ${bg.video?.dimming ?? 0.25})`
      ctx.fillRect(0, 0, width, height)
      break
    }
    case "solid":
      ctx.fillStyle = bg.color
      ctx.fillRect(0, 0, width, height)
      break

    case "gradient": {
      if (!bg.gradient) break
      let grad: CanvasGradient

      if (bg.gradient.type === "linear") {
        const angle = (bg.gradient.angle * Math.PI) / 180
        const cx = width / 2
        const cy = height / 2
        const len = Math.sqrt(width * width + height * height) / 2
        grad = ctx.createLinearGradient(
          cx - Math.cos(angle) * len,
          cy - Math.sin(angle) * len,
          cx + Math.cos(angle) * len,
          cy + Math.sin(angle) * len
        )
      } else {
        grad = ctx.createRadialGradient(
          width / 2,
          height / 2,
          0,
          width / 2,
          height / 2,
          Math.max(width, height) / 2
        )
      }

      for (const stop of bg.gradient.stops) {
        grad.addColorStop(stop.position / 100, stop.color)
      }

      ctx.fillStyle = grad
      ctx.fillRect(0, 0, width, height)
      break
    }

    case "image": {
      ctx.fillStyle = bg.color || "#000000"
      ctx.fillRect(0, 0, width, height)
      if (!bg.image) {
        ctx.fillStyle = "#000"
        ctx.fillRect(0, 0, width, height)
        break
      }
      const img = imageCache?.get(bg.image.url)
      if (!img) {
        // Use a deterministic fallback while image is still loading.
        ctx.fillStyle = bg.image.tint ?? "#000"
        ctx.fillRect(0, 0, width, height)
        break
      }

      ctx.save()

      const nativeFilters = typeof ctx.filter === "string"
      if (nativeFilters && bg.image.blur > 0) {
        ctx.filter = `blur(${bg.image.blur}px) brightness(${bg.image.brightness}%)`
      } else if (nativeFilters && bg.image.brightness !== 100) {
        ctx.filter = `brightness(${bg.image.brightness}%)`
      }

      let drawX = 0
      let drawY = 0
      let drawW = width
      let drawH = height

      const imgRatio = img.naturalWidth / img.naturalHeight
      const canvasRatio = width / height

      switch (bg.image.fit) {
        case "cover":
          if (imgRatio > canvasRatio) {
            drawH = height
            drawW = height * imgRatio
            drawX = (width - drawW) / 2
          } else {
            drawW = width
            drawH = width / imgRatio
            drawY = (height - drawH) / 2
          }
          break
        case "contain":
          if (imgRatio > canvasRatio) {
            drawW = width
            drawH = width / imgRatio
            drawY = (height - drawH) / 2
          } else {
            drawH = height
            drawW = height * imgRatio
            drawX = (width - drawW) / 2
          }
          break
        case "stretch":
          break
      }

      ctx.drawImage(
        backgroundWithEffects(ctx, img, bg.image, drawW, drawH),
        drawX,
        drawY,
        drawW,
        drawH
      )
      ctx.restore()

      if (bg.image.tint) {
        ctx.fillStyle = bg.image.tint
        ctx.fillRect(0, 0, width, height)
      }
      break
    }

    case "transparent":
      ctx.clearRect(0, 0, width, height)
      break
  }
}

function drawReference(
  ctx: CanvasRenderingContext2D,
  theme: BroadcastTheme,
  text: string,
  textRectX: number,
  textRectWidth: number,
  y: number
): number {
  const ref = theme.reference
  const referenceColor = opaqueTextColor(ref.color)
  const transformed = applyTextTransform(
    ref.uppercase ? text.toUpperCase() : text,
    resolveTextTransform(ref.textTransform)
  )
  const refAlign = resolveHorizontalAlign(
    ref.horizontalAlign,
    theme.layout.textAlign,
    false
  )
  const refDecoration = resolveTextDecoration(ref.textDecoration)

  ctx.save()
  ctx.globalAlpha = 1
  ctx.font = `${ref.fontWeight} ${ref.fontSize}px "${ref.fontFamily}", sans-serif`
  ctx.fillStyle = referenceColor
  ctx.textBaseline = "top"

  if (ref.letterSpacing !== undefined) {
    try {
      ctx.letterSpacing = `${ref.letterSpacing}px`
    } catch {
      /* unsupported in some WebViews */
    }
  }

  const canvasAlign = refAlign === "justify" ? "left" : refAlign
  ctx.textAlign = canvasAlign
  const x = alignX(canvasAlign, textRectX, textRectWidth)
  ctx.fillText(transformed, x, y)
  const drawnWidth = Math.min(
    textRectWidth,
    Math.max(1, ctx.measureText(transformed).width)
  )
  drawTextDecorationLine(
    ctx,
    refDecoration,
    referenceColor,
    refAlign,
    x,
    y,
    drawnWidth,
    ref.fontSize,
    textRectX
  )
  ctx.restore()

  return ref.fontSize * 1.5
}

function drawVerseText(
  ctx: CanvasRenderingContext2D,
  theme: BroadcastTheme,
  verse: VerseRenderData,
  textRectX: number,
  textRectWidth: number,
  startY: number
): number {
  const vt = theme.verseText
  const vn = theme.verseNumbers
  if (
    vn.visible &&
    verse.segments.some((segment) => segment.verseNumber !== undefined)
  ) {
    return drawNumberedVerse(
      ctx,
      theme,
      verse,
      textRectX,
      textRectWidth,
      startY
    )
  }
  const verseAlign = resolveHorizontalAlign(
    vt.horizontalAlign,
    theme.layout.textAlign,
    true
  )
  const verseDecoration = resolveTextDecoration(vt.textDecoration)
  const lineHeightPx = vt.fontSize * vt.lineHeight

  ctx.save()
  ctx.font = `${vt.fontWeight} ${vt.fontSize}px "${vt.fontFamily}", serif`
  ctx.fillStyle = vt.color
  ctx.textBaseline = "top"
  ctx.textAlign = verseAlign === "justify" ? "left" : verseAlign

  if (vt.letterSpacing !== undefined) {
    try {
      ctx.letterSpacing = `${vt.letterSpacing}px`
    } catch {
      /* unsupported in some WebViews */
    }
  }

  // Build full text with verse numbers inline
  let fullText = ""
  for (const segment of verse.segments) {
    if (vn.visible && segment.verseNumber !== undefined) {
      fullText += `${segment.verseNumber} `
    }
    fullText += segment.text + " "
  }
  fullText = applyTextTransform(
    fullText.trim(),
    resolveTextTransform(vt.textTransform)
  )

  const useCenteredLines =
    (theme.verseText as Record<string, unknown>).lineBreakMode ===
    "centered-lines"
  const wrappedLines = useCenteredLines
    ? breakIntoCenteredLines(fullText)
    : wrapText(ctx, fullText, textRectWidth)

  let currentY = startY
  const effectiveAlign = useCenteredLines
    ? ("center" as const)
    : verseAlign === "justify"
      ? ("left" as const)
      : verseAlign
  const x = alignX(effectiveAlign, textRectX, textRectWidth)

  const drawStyledLine = (line: string, drawX: number, drawY: number) => {
    if (vt.shadow) {
      ctx.save()
      ctx.shadowColor = vt.shadow.color
      ctx.shadowBlur = vt.shadow.blur
      ctx.shadowOffsetX = vt.shadow.x
      ctx.shadowOffsetY = vt.shadow.y
      ctx.fillText(line, drawX, drawY)
      ctx.restore()
    }

    if (vt.outline) {
      ctx.save()
      ctx.strokeStyle = vt.outline.color
      ctx.lineWidth = vt.outline.width
      ctx.strokeText(line, drawX, drawY)
      ctx.restore()
    }

    if (!vt.shadow) {
      ctx.fillText(line, drawX, drawY)
    }
  }

  for (const [index, line] of wrappedLines.entries()) {
    const isJustifiedLine =
      verseAlign === "justify" &&
      index < wrappedLines.length - 1 &&
      /\s+/.test(line)
    ctx.textAlign = isJustifiedLine ? "left" : effectiveAlign
    if (isJustifiedLine) {
      const words = line.trim().split(/\s+/).filter(Boolean)
      if (words.length > 1) {
        const wordsWidth = words.reduce(
          (sum, word) => sum + ctx.measureText(word).width,
          0
        )
        const gap = (textRectWidth - wordsWidth) / (words.length - 1)
        let cursorX = textRectX
        for (const word of words) {
          drawStyledLine(word, cursorX, currentY)
          cursorX += ctx.measureText(word).width + gap
        }
      } else {
        drawStyledLine(line, textRectX, currentY)
      }
      drawTextDecorationLine(
        ctx,
        verseDecoration,
        vt.color,
        "left",
        textRectX,
        currentY,
        textRectWidth,
        vt.fontSize,
        textRectX
      )
    } else {
      drawStyledLine(line, x, currentY)
      const lineWidth = Math.min(
        textRectWidth,
        Math.max(1, ctx.measureText(line).width)
      )
      drawTextDecorationLine(
        ctx,
        verseDecoration,
        vt.color,
        verseAlign,
        x,
        currentY,
        lineWidth,
        vt.fontSize,
        textRectX
      )
    }
    currentY += lineHeightPx
  }

  ctx.restore()

  return currentY - startY
}

function buildScaledTheme(
  theme: BroadcastTheme,
  scale: number
): BroadcastTheme {
  const layout = {
    ...theme.layout,
    referenceGap:
      theme.layout.referenceGap === undefined
        ? undefined
        : theme.layout.referenceGap * scale,
    offsetX: theme.layout.offsetX * scale,
    offsetY: theme.layout.offsetY * scale,
    padding: {
      top: theme.layout.padding.top * scale,
      right: theme.layout.padding.right * scale,
      bottom: theme.layout.padding.bottom * scale,
      left: theme.layout.padding.left * scale,
    },
  }
  return {
    ...theme,
    layout,
    background: {
      ...theme.background,
      image: theme.background.image
        ? {
            ...theme.background.image,
            blur: theme.background.image.blur * scale,
          }
        : null,
    },
    resolution: {
      width: theme.resolution.width * scale,
      height: theme.resolution.height * scale,
    },
    verseText: {
      ...theme.verseText,
      fontSize: theme.verseText.fontSize * scale,
      letterSpacing: theme.verseText.letterSpacing * scale,
      shadow: theme.verseText.shadow
        ? {
            ...theme.verseText.shadow,
            blur: theme.verseText.shadow.blur * scale,
            x: theme.verseText.shadow.x * scale,
            y: theme.verseText.shadow.y * scale,
          }
        : null,
      outline: theme.verseText.outline
        ? {
            ...theme.verseText.outline,
            width: theme.verseText.outline.width * scale,
          }
        : null,
    },
    verseNumbers: {
      ...theme.verseNumbers,
      fontSize: theme.verseNumbers.fontSize * scale,
    },
    reference: {
      ...theme.reference,
      fontSize: theme.reference.fontSize * scale,
      letterSpacing: theme.reference.letterSpacing * scale,
    },
    textBox: {
      ...theme.textBox,
      borderRadius: theme.textBox.borderRadius * scale,
      padding: theme.textBox.padding * scale,
    },
  }
}

function measureVerseHeight(
  ctx: CanvasRenderingContext2D,
  theme: BroadcastTheme,
  verse: VerseRenderData,
  textRectWidth: number
): { height: number; maxLineWidth: number } {
  if (
    theme.verseNumbers.visible &&
    verse.segments.some((segment) => segment.verseNumber !== undefined)
  ) {
    const lines = numberedVerseLines(ctx, theme, verse, textRectWidth)
    return {
      height:
        lines.length * theme.verseText.fontSize * theme.verseText.lineHeight,
      maxLineWidth: Math.max(1, ...lines.map((line) => line.width)),
    }
  }
  const vt = theme.verseText
  const vn = theme.verseNumbers
  const verseAlign = resolveHorizontalAlign(
    vt.horizontalAlign,
    theme.layout.textAlign,
    true
  )
  const lineHeightPx = vt.fontSize * vt.lineHeight
  ctx.save()
  ctx.font = `${vt.fontWeight} ${vt.fontSize}px "${vt.fontFamily}", serif`
  if (vt.letterSpacing !== undefined) {
    try {
      ctx.letterSpacing = `${vt.letterSpacing}px`
    } catch {
      /* unsupported in some WebViews */
    }
  }
  let fullText = ""
  for (const segment of verse.segments) {
    if (vn.visible && segment.verseNumber !== undefined)
      fullText += `${segment.verseNumber} `
    fullText += `${segment.text} `
  }
  const transformed = applyTextTransform(
    fullText.trim(),
    resolveTextTransform(vt.textTransform)
  )
  const useCenteredLines =
    (theme.verseText as Record<string, unknown>).lineBreakMode ===
    "centered-lines"
  const lines = useCenteredLines
    ? breakIntoCenteredLines(transformed)
    : wrapText(ctx, transformed, textRectWidth)
  let maxLineWidth = 0
  for (const [index, line] of lines.entries()) {
    const isJustifiedLine =
      verseAlign === "justify" && index < lines.length - 1 && /\s+/.test(line)
    const width = isJustifiedLine ? textRectWidth : ctx.measureText(line).width
    if (width > maxLineWidth) maxLineWidth = width
  }
  ctx.restore()
  return {
    height: Math.max(lineHeightPx, lines.length * lineHeightPx),
    maxLineWidth: Math.max(1, maxLineWidth),
  }
}

function rectForAlignedText(
  align: BroadcastTheme["layout"]["textAlign"],
  drawX: number,
  drawY: number,
  width: number,
  height: number,
  textRect: VerseLayoutRect
): VerseLayoutRect {
  let x = drawX
  if (align === "center") x = drawX - width / 2
  if (align === "right") x = drawX - width
  const clampedX = Math.max(
    textRect.x,
    Math.min(x, textRect.x + textRect.width - width)
  )
  const clampedY = Math.max(textRect.y, drawY)
  return {
    x: clampedX,
    y: clampedY,
    width: Math.min(width, textRect.width),
    height: Math.min(height, textRect.height),
  }
}

export function computeVerseLayoutMetrics(
  ctx: CanvasRenderingContext2D,
  theme: BroadcastTheme,
  verse: VerseRenderData | null,
  options?: RenderOptions
): VerseLayoutMetrics {
  const scale = options?.scale ?? 1
  const scaledTheme = buildScaledTheme(theme, scale)
  const canvasW = scaledTheme.resolution.width
  const canvasH = scaledTheme.resolution.height
  const layout = scaledTheme.layout

  const bgW = (layout.backgroundWidth / 100) * canvasW
  const bgH = (layout.backgroundHeight / 100) * canvasH
  const textAreaW = (layout.textAreaWidth / 100) * bgW
  const textAreaH = (layout.textAreaHeight / 100) * bgH
  const globalOffsetX = (options?.offsetX ?? 0) + layout.offsetX
  const globalOffsetY = (options?.offsetY ?? 0) + layout.offsetY
  const pos = anchorPosition(
    layout.anchor,
    textAreaW,
    textAreaH,
    canvasW,
    canvasH,
    globalOffsetX,
    globalOffsetY
  )

  const boxPadding = scaledTheme.textBox.enabled
    ? Math.max(0, scaledTheme.textBox.padding)
    : 0
  const insetX = Math.min(boxPadding, Math.max(0, (textAreaW - 1) / 2))
  const insetY = Math.min(boxPadding, Math.max(0, (textAreaH - 1) / 2))
  const pad = {
    left: Math.min(
      Math.max(0, layout.padding.left),
      Math.max(0, textAreaW - insetX * 2 - 1)
    ),
    right: Math.max(0, layout.padding.right),
    top: Math.max(0, layout.padding.top),
    bottom: Math.max(0, layout.padding.bottom),
  }
  const textRectX = pos.x + pad.left + insetX
  let textRectY =
    pos.y + Math.min(pad.top, Math.max(0, textAreaH - insetY * 2 - 1)) + insetY
  const textRectW = Math.max(1, textAreaW - pad.left - pad.right - insetX * 2)
  let textRectH = Math.max(1, textAreaH - pad.top - pad.bottom - insetY * 2)

  // Reserve space taken by the logo so verse/reference don't overlap it.
  // Mirror the reduction on the opposite side so a vertically-centered block
  // remains visually centered on the canvas.
  if (scaledTheme.logo?.url) {
    const logo = scaledTheme.logo
    const logoH = logo.size * scale
    const logoMargin = logo.margin * scale
    const reserve = logoH + logoMargin
    if (logo.position === "top-left" || logo.position === "top-right") {
      const shift = Math.max(0, reserve - pad.top)
      textRectY += shift
      textRectH = Math.max(0, textRectH - shift * 2)
    } else if (
      logo.position === "bottom-left" ||
      logo.position === "bottom-right"
    ) {
      const shift = Math.max(0, reserve - pad.bottom)
      textRectH = Math.max(0, textRectH - shift * 2)
    }
  }

  const textAreaRect: VerseLayoutRect = {
    x: pos.x,
    y: pos.y,
    width: textAreaW,
    height: textAreaH,
  }
  const textRect: VerseLayoutRect = {
    x: textRectX,
    y: textRectY,
    width: textRectW,
    height: textRectH,
  }

  if (!verse) {
    return {
      scaledTheme,
      textAreaRect,
      textRect,
      referenceRect: null,
      verseRect: null,
      wordHits: [],
      highlightRects: [],
    }
  }

  const referenceHeight = scaledTheme.reference.fontSize * 1.5
  const refStandalone = scaledTheme.reference.standalone
  const verseAlign = resolveHorizontalAlign(
    scaledTheme.verseText.horizontalAlign,
    scaledTheme.layout.textAlign,
    true
  )
  const referenceAlign = resolveHorizontalAlign(
    scaledTheme.reference.horizontalAlign,
    scaledTheme.layout.textAlign,
    false
  )
  const blockVerticalAlign = resolveVerticalAlign(
    refStandalone
      ? scaledTheme.verseText.verticalAlign
      : scaledTheme.reference.position === "above"
        ? (scaledTheme.reference.verticalAlign ??
          scaledTheme.verseText.verticalAlign)
        : (scaledTheme.verseText.verticalAlign ??
          scaledTheme.reference.verticalAlign)
  )
  const referenceGap = Math.max(
    0,
    scaledTheme.layout.referenceGap ?? scaledTheme.reference.fontSize * 0.5
  )
  if (scaledTheme.verseText.autoFit) {
    const minFs = Math.max(8, scaledTheme.verseText.minFontSize ?? 24) * scale
    const refBlock =
      scaledTheme.reference.position === "above"
        ? referenceHeight + referenceGap
        : scaledTheme.reference.position === "below"
          ? referenceHeight + referenceGap
          : referenceHeight
    const availH = Math.max(
      0,
      textRectH - (verse.hideReference || refStandalone ? 0 : refBlock)
    )
    let fs = scaledTheme.verseText.fontSize
    for (let i = 0; i < 24; i++) {
      const m = measureVerseHeight(ctx, scaledTheme, verse, textRectW)
      if (m.height <= availH && m.maxLineWidth <= textRectW) break
      if (fs <= minFs) break
      const next = Math.max(minFs, Math.floor((fs / scale) * 0.94) * scale)
      if (next === fs) break
      fs = next
      scaledTheme.verseText = { ...scaledTheme.verseText, fontSize: fs }
    }
  }
  const verseMetrics = measureVerseHeight(ctx, scaledTheme, verse, textRectW)
  const verseHeight = verseMetrics.height
  const verseDrawX = alignX(
    verseAlign === "justify" ? "left" : verseAlign,
    textRectX,
    textRectW
  )
  if (verse.hideReference) {
    const verseRect = rectForAlignedText(
      verseAlign === "justify" ? "left" : verseAlign,
      verseDrawX,
      alignY(blockVerticalAlign, textRectY, textRectH, verseHeight),
      verseMetrics.maxLineWidth,
      verseHeight,
      textRect
    )
    const wordHits =
      options?.collectWordHits || verse.highlights?.length
        ? computeWordHits(ctx, scaledTheme, verse, textRect, verseRect.y)
        : []
    return {
      scaledTheme,
      textAreaRect,
      textRect,
      referenceRect: null,
      verseRect,
      contentOverflows:
        verseHeight > textRectH || verseMetrics.maxLineWidth > textRectW,
      wordHits,
      highlightRects: highlightRectsFor(verse, wordHits),
    }
  }
  const referenceDrawX = alignX(
    referenceAlign === "justify" ? "left" : referenceAlign,
    textRectX,
    textRectW
  )

  const refText = applyTextTransform(
    scaledTheme.reference.uppercase
      ? verse.reference.toUpperCase()
      : verse.reference,
    resolveTextTransform(scaledTheme.reference.textTransform)
  )
  ctx.save()
  ctx.font = `${scaledTheme.reference.fontWeight} ${scaledTheme.reference.fontSize}px "${scaledTheme.reference.fontFamily}", sans-serif`
  ctx.letterSpacing = `${scaledTheme.reference.letterSpacing}px`
  const measuredReferenceWidth = ctx.measureText(refText).width
  const referenceWidth = Math.max(
    1,
    Math.min(textRectW, measuredReferenceWidth)
  )
  ctx.restore()

  const blockHeight = refStandalone
    ? verseHeight
    : scaledTheme.reference.position === "above"
      ? referenceHeight + referenceGap + verseHeight
      : scaledTheme.reference.position === "below"
        ? verseHeight + referenceGap + referenceHeight
        : verseHeight + referenceHeight
  const blockStartY = alignY(
    blockVerticalAlign,
    textRectY,
    textRectH,
    blockHeight
  )

  let referenceRect: VerseLayoutRect
  let verseRect: VerseLayoutRect
  if (refStandalone) {
    const verseY = blockStartY
    verseRect = rectForAlignedText(
      verseAlign === "justify" ? "left" : verseAlign,
      verseDrawX,
      verseY,
      verseMetrics.maxLineWidth,
      verseHeight,
      textRect
    )
    const standaloneMargin = refStandalone.margin * scale
    const refX = refStandalone.anchor.endsWith("center")
      ? (canvasW - referenceWidth) / 2
      : refStandalone.anchor.endsWith("right")
        ? canvasW - standaloneMargin - referenceWidth
        : standaloneMargin
    const refY = refStandalone.anchor.startsWith("bottom")
      ? canvasH - standaloneMargin - referenceHeight
      : standaloneMargin
    referenceRect = {
      x: refX,
      y: refY,
      width: referenceWidth,
      height: referenceHeight,
    }
    const wordHits =
      options?.collectWordHits || verse.highlights?.length
        ? computeWordHits(ctx, scaledTheme, verse, textRect, verseRect.y)
        : []
    return {
      scaledTheme,
      contentOverflows:
        verseHeight > textRectH || verseMetrics.maxLineWidth > textRectW,
      textAreaRect,
      textRect,
      referenceRect,
      verseRect,
      wordHits,
      highlightRects: highlightRectsFor(verse, wordHits),
    }
  }
  if (scaledTheme.reference.position === "above") {
    const refY = blockStartY
    const verseY = blockStartY + referenceHeight + referenceGap
    referenceRect = rectForAlignedText(
      referenceAlign === "justify" ? "left" : referenceAlign,
      referenceDrawX,
      refY,
      referenceWidth,
      referenceHeight,
      textRect
    )
    verseRect = rectForAlignedText(
      verseAlign === "justify" ? "left" : verseAlign,
      verseDrawX,
      verseY,
      verseMetrics.maxLineWidth,
      verseHeight,
      textRect
    )
  } else if (scaledTheme.reference.position === "below") {
    const verseY = blockStartY
    const refY = blockStartY + verseHeight + referenceGap
    verseRect = rectForAlignedText(
      verseAlign === "justify" ? "left" : verseAlign,
      verseDrawX,
      verseY,
      verseMetrics.maxLineWidth,
      verseHeight,
      textRect
    )
    referenceRect = rectForAlignedText(
      referenceAlign === "justify" ? "left" : referenceAlign,
      referenceDrawX,
      refY,
      referenceWidth,
      referenceHeight,
      textRect
    )
  } else {
    const verseY = blockStartY
    const refY = blockStartY + verseHeight
    verseRect = rectForAlignedText(
      verseAlign === "justify" ? "left" : verseAlign,
      verseDrawX,
      verseY,
      verseMetrics.maxLineWidth,
      verseHeight,
      textRect
    )
    referenceRect = rectForAlignedText(
      referenceAlign === "justify" ? "left" : referenceAlign,
      referenceDrawX,
      refY,
      referenceWidth,
      referenceHeight,
      textRect
    )
  }

  const wordHits =
    options?.collectWordHits || verse.highlights?.length
      ? computeWordHits(ctx, scaledTheme, verse, textRect, verseRect.y)
      : []
  return {
    scaledTheme,
    contentOverflows:
      verseHeight > textRectH || verseMetrics.maxLineWidth > textRectW,
    textAreaRect,
    textRect,
    referenceRect,
    verseRect,
    wordHits,
    highlightRects: highlightRectsFor(verse, wordHits),
  }
}

function computeWordHits(
  ctx: CanvasRenderingContext2D,
  theme: BroadcastTheme,
  verse: VerseRenderData,
  textRect: VerseLayoutRect,
  startY: number
): WordHitBox[] {
  if (verse.segments.length !== 1) return []
  if (
    theme.verseNumbers.visible &&
    verse.segments[0].verseNumber !== undefined
  ) {
    return numberedVerseHits(ctx, theme, verse, textRect, startY)
  }
  const segment = verse.segments[0]
  const sourceWords = [...segment.text.matchAll(/\S+/g)].map((match) => ({
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }))
  const vt = theme.verseText
  const vn = theme.verseNumbers
  const transform = resolveTextTransform(vt.textTransform)
  const verseAlign = resolveHorizontalAlign(
    vt.horizontalAlign,
    theme.layout.textAlign,
    true
  )
  const lineHeight = vt.fontSize * vt.lineHeight
  const prefix =
    vn.visible && segment.verseNumber !== undefined
      ? `${segment.verseNumber} `
      : ""
  const fullText = applyTextTransform(
    `${prefix}${segment.text}`.trim(),
    transform
  )
  ctx.save()
  ctx.font = `${vt.fontWeight} ${vt.fontSize}px "${vt.fontFamily}", serif`
  if (vt.letterSpacing !== undefined) {
    try {
      ctx.letterSpacing = `${vt.letterSpacing}px`
    } catch {
      /* unsupported in some WebViews */
    }
  }
  const centered =
    (theme.verseText as Record<string, unknown>).lineBreakMode ===
    "centered-lines"
  const lines = centered
    ? breakIntoCenteredLines(fullText)
    : wrapText(ctx, fullText, textRect.width)
  const hits: WordHitBox[] = []
  let sourceIndex = 0
  for (const [lineIndex, line] of lines.entries()) {
    const words = [...line.matchAll(/\S+/g)]
    const justified =
      verseAlign === "justify" &&
      lineIndex < lines.length - 1 &&
      words.length > 1
    const wordsWidth = words.reduce(
      (sum, word) => sum + ctx.measureText(word[0]).width,
      0
    )
    const gap = justified
      ? (textRect.width - wordsWidth) / (words.length - 1)
      : ctx.measureText(" ").width
    const lineWidth = justified ? textRect.width : ctx.measureText(line).width
    const align = centered
      ? "center"
      : verseAlign === "justify"
        ? "left"
        : verseAlign
    const lineX =
      align === "center"
        ? textRect.x + (textRect.width - lineWidth) / 2
        : align === "right"
          ? textRect.x + textRect.width - lineWidth
          : textRect.x
    let cursorX = lineX
    for (const match of words) {
      const word = match[0]
      // Measure prefixes like fillText(line) does, including spacing and kerning.
      const prefixWidth = justified
        ? 0
        : ctx.measureText(line.slice(0, match.index)).width
      const x = justified ? cursorX : lineX + prefixWidth
      const width = justified
        ? ctx.measureText(word).width
        : ctx.measureText(line.slice(0, match.index + word.length)).width -
          prefixWidth
      const source = sourceWords[sourceIndex]
      if (
        source &&
        applyTextTransform(source.text, transform).toLocaleLowerCase() ===
          word.toLocaleLowerCase()
      ) {
        hits.push({
          segmentIndex: 0,
          start: source.start,
          end: source.end,
          x,
          y: startY,
          width,
          height: lineHeight,
        })
        sourceIndex += 1
      }
      cursorX += width + gap
    }
    startY += lineHeight
  }
  ctx.restore()
  return hits
}

function highlightRectsFor(
  verse: VerseRenderData,
  hits: readonly WordHitBox[]
): HighlightLayoutRect[] {
  if (verse.segments.length !== 1 || hits.length === 0) return []
  const highlights = validHighlights(
    verse.segments[0].text,
    verse.highlights ?? []
  )
  return highlights.flatMap((highlight) => {
    const lines = new Map<number, HighlightLayoutRect>()
    for (const hit of hits) {
      if (
        hit.segmentIndex !== highlight.segmentIndex ||
        hit.end <= highlight.start ||
        hit.start >= highlight.end
      )
        continue
      const padding = Math.min(3, hit.height * 0.04)
      const left = hit.x - padding
      const right = hit.x + hit.width + padding
      const previous = lines.get(hit.y)
      if (previous) {
        const lineRight = Math.max(previous.x + previous.width, right)
        previous.x = Math.min(previous.x, left)
        previous.width = lineRight - previous.x
      } else {
        lines.set(hit.y, {
          x: left,
          y: hit.y + hit.height * 0.08,
          width: right - left,
          height: hit.height * 0.84,
          color: highlight.color,
        })
      }
    }
    return [...lines.values()]
  })
}

function breakIntoCenteredLines(text: string): string[] {
  const parts = text.split(/([,;:.!?])\s*/g)
  const lines: string[] = []
  let current = ""

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (/^[,;:.!?]$/.test(part)) {
      current += part
      lines.push(current.trim())
      current = ""
    } else {
      const words = part.trim().split(/\s+/)
      for (const word of words) {
        if (current.split(/\s+/).filter(Boolean).length >= 6) {
          lines.push(current.trim())
          current = ""
        }
        current += (current ? " " : "") + word
      }
    }
  }
  if (current.trim()) lines.push(current.trim())
  return lines.filter(Boolean)
}

function drawDivider(
  ctx: CanvasRenderingContext2D,
  divider: {
    style: string
    color: string
    width: number
    opacity: number
    dotCount: number
    dotSize: number
  },
  centerX: number,
  y: number,
  scale: number
): number {
  if (divider.style === "none") return 0

  ctx.save()
  ctx.globalAlpha = divider.opacity

  const scaledWidth = divider.width * scale

  if (divider.style === "line") {
    ctx.strokeStyle = divider.color
    ctx.lineWidth = 1 * scale
    ctx.beginPath()
    ctx.moveTo(centerX - scaledWidth / 2, y)
    ctx.lineTo(centerX + scaledWidth / 2, y)
    ctx.stroke()
  } else if (divider.style === "dots") {
    ctx.fillStyle = divider.color
    const dotSize = divider.dotSize * scale
    const dotGap = 6 * scale
    const totalWidth =
      divider.dotCount * dotSize + (divider.dotCount - 1) * dotGap
    let dotX = centerX - totalWidth / 2
    for (let i = 0; i < divider.dotCount; i++) {
      ctx.beginPath()
      ctx.arc(dotX + dotSize / 2, y, dotSize / 2, 0, Math.PI * 2)
      ctx.fill()
      dotX += dotSize + dotGap
    }
  }

  ctx.restore()
  return 20 * scale
}

export function renderVerse(
  ctx: CanvasRenderingContext2D,
  theme: BroadcastTheme,
  verse: VerseRenderData | null,
  options?: RenderOptions
): VerseLayoutMetrics | null {
  try {
    return renderVerseImpl(ctx, theme, verse, options)
  } catch (e) {
    console.error("[verse-renderer] render error:", e)
    return null
  }
}

function renderVerseImpl(
  ctx: CanvasRenderingContext2D,
  theme: BroadcastTheme,
  verse: VerseRenderData | null,
  options?: RenderOptions
): VerseLayoutMetrics {
  const metrics = computeVerseLayoutMetrics(ctx, theme, verse, options)
  const scaledTheme = metrics.scaledTheme

  ctx.save()

  // Apply global opacity
  if (options?.opacity !== undefined) {
    ctx.globalAlpha = options.opacity
  }

  // Each frame replaces the old one, including translucent colors and contain bars.
  ctx.clearRect(
    0,
    0,
    scaledTheme.resolution.width,
    scaledTheme.resolution.height
  )
  // Draw background
  drawBackground(ctx, scaledTheme, options?.imageCache, options?.backgroundVideo)

  // Draw text box if enabled
  if (scaledTheme.textBox.enabled) {
    ctx.save()
    ctx.globalAlpha = (options?.opacity ?? 1) * scaledTheme.textBox.opacity
    ctx.fillStyle = scaledTheme.textBox.color
    roundRect(
      ctx,
      metrics.textAreaRect.x,
      metrics.textAreaRect.y,
      metrics.textAreaRect.width,
      metrics.textAreaRect.height,
      scaledTheme.textBox.borderRadius
    )
    ctx.fill()
    ctx.restore()
  }

  // If no verse data, just draw the background and text box
  if (!verse) {
    drawLogo(ctx, scaledTheme, options?.scale ?? 1, options?.imageCache)
    ctx.restore()
    return metrics
  }

  const referenceRect = metrics.referenceRect
  const verseRect = metrics.verseRect
  const scale = options?.scale ?? 1
  const divider = scaledTheme.divider
  const resolvedDivider = divider ?? {
    style: "none" as const,
    color: "#fff",
    width: 0,
    opacity: 0,
    dotCount: 0,
    dotSize: 0,
  }

  let dividerOffset = 0
  if (verseRect) {
    for (const rect of metrics.highlightRects) {
      ctx.save()
      ctx.fillStyle = rect.color
      ctx.globalAlpha = (options?.opacity ?? 1) * 0.72
      roundRect(
        ctx,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        Math.min(8 * scale, rect.height / 4)
      )
      ctx.fill()
      ctx.restore()
    }
    const verseH = drawVerseText(
      ctx,
      scaledTheme,
      verse,
      metrics.textRect.x,
      metrics.textRect.width,
      verseRect.y
    )
    if (referenceRect && resolvedDivider.style !== "none") {
      const dividerY = verseRect.y + verseH + 10 * scale
      const centerX = metrics.textRect.x + metrics.textRect.width / 2
      dividerOffset = drawDivider(
        ctx,
        resolvedDivider,
        centerX,
        dividerY,
        scale
      )
    }
  }
  if (referenceRect) {
    if (scaledTheme.reference.standalone) {
      drawReference(
        ctx,
        scaledTheme,
        verse.reference,
        referenceRect.x,
        referenceRect.width,
        referenceRect.y
      )
    } else {
      drawReference(
        ctx,
        scaledTheme,
        verse.reference,
        metrics.textRect.x,
        metrics.textRect.width,
        referenceRect.y + dividerOffset
      )
    }
  }

  drawLogo(ctx, scaledTheme, scale, options?.imageCache)

  ctx.restore()
  return metrics
}

function drawLogo(
  ctx: CanvasRenderingContext2D,
  theme: BroadcastTheme,
  scale: number,
  imageCache?: Map<string, HTMLImageElement>
) {
  const logo = theme.logo
  if (!logo || !logo.url) return
  const img = imageCache?.get(logo.url)
  if (!img || !img.complete || img.naturalWidth === 0) return

  const margin = logo.margin * scale
  const aspect = img.naturalWidth / img.naturalHeight
  const h = logo.size * scale
  const w = h * aspect
  const canvasW = theme.resolution.width
  const canvasH = theme.resolution.height

  let x = margin
  let y = margin
  if (logo.position === "top-right") {
    x = canvasW - w - margin
    y = margin
  } else if (logo.position === "bottom-left") {
    x = margin
    y = canvasH - h - margin
  } else if (logo.position === "bottom-right") {
    x = canvasW - w - margin
    y = canvasH - h - margin
  }

  ctx.save()
  ctx.globalAlpha = (ctx.globalAlpha ?? 1) * logo.opacity
  ctx.drawImage(img, x, y, w, h)
  ctx.restore()
}

function numberedLinePositions(
  ctx: CanvasRenderingContext2D,
  theme: BroadcastTheme,
  line: ReturnType<typeof numberedVerseLines>[number],
  last: boolean,
  left: number,
  width: number
) {
  const align =
    theme.verseText.lineBreakMode === "centered-lines"
      ? "center"
      : (theme.verseText.horizontalAlign ?? theme.layout.textAlign)
  const justified = align === "justify" && !last && line.words.length > 1
  const wordsWidth = line.words.reduce(
    (sum, word) => sum + measureVerseWords(ctx, theme, [word]),
    0
  )
  const gap = justified ? (width - wordsWidth) / (line.words.length - 1) : 0
  const origin =
    align === "center"
      ? left + (width - line.width) / 2
      : align === "right"
        ? left + width - line.width
        : left
  let cursor = origin
  return line.words.map((word, index) => {
    const x = justified
      ? cursor
      : origin +
        measureVerseWords(ctx, theme, line.words.slice(0, index), index > 0)
    const wordWidth = measureVerseWords(ctx, theme, [word])
    cursor += wordWidth + gap
    return { word, x, width: wordWidth }
  })
}
function drawNumberedVerse(
  ctx: CanvasRenderingContext2D,
  theme: BroadcastTheme,
  verse: VerseRenderData,
  left: number,
  width: number,
  y: number
) {
  const lines = numberedVerseLines(ctx, theme, verse, width)
  const vt = theme.verseText
  ctx.save()
  ctx.textAlign = "left"
  ctx.textBaseline = "top"
  ctx.letterSpacing = `${vt.letterSpacing}px`
  lines.forEach((line, index) => {
    for (const { word, x } of numberedLinePositions(
      ctx,
      theme,
      line,
      index === lines.length - 1,
      left,
      width
    )) {
      ctx.font = numberedWordFont(theme, word.number)
      ctx.fillStyle = word.number ? theme.verseNumbers.color : vt.color
      const wordY =
        y +
        index * vt.fontSize * vt.lineHeight -
        (word.number && theme.verseNumbers.superscript ? vt.fontSize * 0.08 : 0)
      ctx.save()
      if (!word.number && vt.shadow) {
        ctx.shadowColor = vt.shadow.color
        ctx.shadowBlur = vt.shadow.blur
        ctx.shadowOffsetX = vt.shadow.x
        ctx.shadowOffsetY = vt.shadow.y
      }
      ctx.fillText(word.text, x, wordY)
      ctx.restore()
      if (!word.number && vt.outline) {
        ctx.strokeStyle = vt.outline.color
        ctx.lineWidth = vt.outline.width
        ctx.strokeText(word.text, x, wordY)
      }
    }
    const align =
      vt.lineBreakMode === "centered-lines"
        ? "center"
        : (vt.horizontalAlign ?? theme.layout.textAlign)
    const x =
      align === "center"
        ? left + width / 2
        : align === "right"
          ? left + width
          : left
    drawTextDecorationLine(
      ctx,
      resolveTextDecoration(vt.textDecoration),
      vt.color,
      align,
      x,
      y + index * vt.fontSize * vt.lineHeight,
      line.width,
      vt.fontSize,
      left
    )
  })
  ctx.restore()
  return lines.length * vt.fontSize * vt.lineHeight
}
function numberedVerseHits(
  ctx: CanvasRenderingContext2D,
  theme: BroadcastTheme,
  verse: VerseRenderData,
  rect: VerseLayoutRect,
  y: number
): WordHitBox[] {
  const lines = numberedVerseLines(ctx, theme, verse, rect.width)
  ctx.save()
  const hits = lines.flatMap((line, index) =>
    numberedLinePositions(
      ctx,
      theme,
      line,
      index === lines.length - 1,
      rect.x,
      rect.width
    )
      .filter(({ word }) => !word.number)
      .map(({ word, x, width }) => ({
        segmentIndex: word.segmentIndex,
        start: word.start!,
        end: word.end!,
        x,
        y: y + index * theme.verseText.fontSize * theme.verseText.lineHeight,
        width,
        height: theme.verseText.fontSize * theme.verseText.lineHeight,
      }))
  )
  ctx.restore()
  return hits
}
