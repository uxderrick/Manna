import type { BroadcastTheme } from "@/types/broadcast"
import { BUILTIN_THEMES } from "./builtin-themes"

const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value))
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value)

/** Validate saved/imported themes before any canvas or editor uses them. */
export function parseBroadcastTheme(input: unknown): BroadcastTheme {
  if (
    !record(input) ||
    typeof input.id !== "string" ||
    !input.id.trim() ||
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.length > 120
  )
    throw new Error("Theme needs a name and ID.")
  for (const key of [
    "resolution",
    "background",
    "verseText",
    "reference",
    "layout",
  ]) {
    if (!record(input[key])) throw new Error(`Theme is missing ${key}.`)
  }
  const base = structuredClone(BUILTIN_THEMES[0])
  const value = input as unknown as BroadcastTheme
  const theme: BroadcastTheme = {
    ...base,
    ...value,
    resolution: { ...base.resolution, ...value.resolution },
    background: { ...base.background, ...value.background },
    verseText: {
      ...base.verseText,
      ...value.verseText,
      horizontalAlign: value.verseText.horizontalAlign,
      verticalAlign: value.verseText.verticalAlign,
      textTransform: value.verseText.textTransform,
      textDecoration: value.verseText.textDecoration,
      autoFit: value.verseText.autoFit ?? false,
      minFontSize: value.verseText.minFontSize,
      shadow: value.verseText.shadow ?? null,
      outline: value.verseText.outline ?? null,
    },
    reference: {
      ...base.reference,
      ...value.reference,
      standalone: value.reference.standalone ?? null,
      horizontalAlign: value.reference.horizontalAlign,
      verticalAlign: value.reference.verticalAlign,
      textTransform: value.reference.textTransform,
      textDecoration: value.reference.textDecoration,
    },
    logo: value.logo ?? null,
    layout: {
      ...base.layout,
      ...value.layout,
      referenceGap: value.layout.referenceGap,
      padding: { ...base.layout.padding, ...value.layout.padding },
    },
    textBox: { ...base.textBox, ...value.textBox },
    verseNumbers: { ...base.verseNumbers, ...value.verseNumbers },
    divider: { ...base.divider, ...value.divider },
    transition: { ...base.transition, ...value.transition },
  }
  const color = (value: unknown) =>
    typeof value === "string" &&
    value.length <= 150 &&
    (typeof CSS !== "undefined"
      ? CSS.supports("color", value)
      : /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value) ||
        /^(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\([\d\s.,%+/a-z-]+\)$/i.test(
          value
        ) ||
        /^(?:transparent|black|white|red|green|blue|yellow|gray|grey|orange|purple)$/i.test(
          value
        ))
  for (const value of [
    theme.background.color,
    theme.verseText.color,
    theme.reference.color,
    theme.textBox.color,
    theme.verseNumbers.color,
    theme.divider.color,
    theme.background.image?.tint,
    theme.verseText.shadow?.color,
    theme.verseText.outline?.color,
    ...(Array.isArray(theme.background.gradient?.stops)
      ? theme.background.gradient.stops.map((s) => s?.color)
      : []),
  ]) {
    if (value !== undefined && value !== null && !color(value))
      throw new Error("Theme contains an invalid color.")
  }
  for (const key of ["builtin", "pinned"] as const)
    if (typeof theme[key] !== "boolean")
      throw new Error("Theme flags are invalid.")
  for (const flag of [
    theme.textBox.enabled,
    theme.verseNumbers.visible,
    theme.verseNumbers.superscript,
    theme.reference.uppercase,
  ])
    if (typeof flag !== "boolean")
      throw new Error("Theme display settings are invalid.")
  const inRange = (n: unknown, min: number, max: number) =>
    finite(n) && n >= min && n <= max
  if (
    !inRange(theme.resolution.width, 320, 7680) ||
    !inRange(theme.resolution.height, 180, 4320)
  )
    throw new Error("Theme resolution is invalid.")
  const oneOf = (value: unknown, options: readonly string[]) =>
    options.includes(value as string)
  if (
    !oneOf(theme.background.type, [
      "solid",
      "gradient",
      "image",
      "video",
      "transparent",
    ]) ||
    !oneOf(theme.layout.anchor, [
      "top-left",
      "top-center",
      "top-right",
      "center-left",
      "center",
      "center-right",
      "bottom-left",
      "bottom-center",
      "bottom-right",
    ]) ||
    !oneOf(theme.layout.textAlign, ["left", "center", "right"]) ||
    !oneOf(theme.reference.position, ["above", "below", "inline"])
  )
    throw new Error("Theme layout is invalid.")
  for (const text of [theme.verseText, theme.reference]) {
    if (
      typeof text.fontFamily !== "string" ||
      !text.fontFamily.trim() ||
      text.fontFamily.length > 100 ||
      !inRange(text.fontSize, 8, 300) ||
      !inRange(text.fontWeight, 100, 900) ||
      !inRange(text.letterSpacing, -20, 100) ||
      typeof text.color !== "string" ||
      text.color.length > 150 ||
      (text.horizontalAlign &&
        !oneOf(text.horizontalAlign, ["left", "center", "right", "justify"])) ||
      (text.verticalAlign &&
        !oneOf(text.verticalAlign, ["top", "middle", "bottom"])) ||
      (text.textTransform &&
        !oneOf(text.textTransform, [
          "none",
          "uppercase",
          "lowercase",
          "capitalize",
        ])) ||
      (text.textDecoration &&
        !oneOf(text.textDecoration, ["none", "underline", "line-through"]))
    )
      throw new Error("Theme typography is invalid.")
  }
  if (
    !inRange(theme.verseText.lineHeight, 0.5, 3) ||
    !oneOf(theme.verseText.lineBreakMode, ["flow", "centered-lines"])
  )
    throw new Error("Theme line layout is invalid.")
  for (const key of [
    "backgroundWidth",
    "backgroundHeight",
    "textAreaWidth",
    "textAreaHeight",
  ] as const) {
    if (!inRange(theme.layout[key], 10, 100))
      throw new Error("Theme area dimensions must be between 10% and 100%.")
  }
  if (
    !inRange(theme.layout.offsetX, -7680, 7680) ||
    !inRange(theme.layout.offsetY, -4320, 4320) ||
    !Object.values(theme.layout.padding).every((n) => inRange(n, 0, 7680))
  )
    throw new Error("Theme padding or offset is invalid.")
  const asset = (url: unknown) =>
    typeof url === "string" &&
    url.length <= 12 * 1024 * 1024 &&
    (!url ||
      /^(?:\/(?!\/)|data:image\/(?:png|jpe?g|webp|gif|svg\+xml);|https?:\/\/|asset:)/i.test(
        url
      ))
  const image = theme.background.image
  const video = theme.background.video
  if (theme.background.type === "video" && (!video || !asset(video.url) || !video.url || !inRange(video.dimming, 0, 0.8) || (video.poster !== undefined && !asset(video.poster))))
    throw new Error("Theme video settings are invalid.")
  if (theme.background.type === "image" && !image)
    throw new Error("Theme image settings are missing.")
  if (
    image &&
    (!asset(image.url) ||
      !oneOf(image.fit, ["cover", "contain", "stretch"]) ||
      !inRange(image.blur, 0, 50) ||
      !inRange(image.brightness, 0, 200) ||
      (image.tint !== null && typeof image.tint !== "string"))
  )
    throw new Error("Theme image settings are invalid.")
  const gradient = theme.background.gradient
  if (theme.background.type === "gradient" && !gradient)
    throw new Error("Theme gradient is missing.")
  if (
    gradient &&
    (!oneOf(gradient.type, ["linear", "radial"]) ||
      !inRange(gradient.angle, 0, 360) ||
      !Array.isArray(gradient.stops) ||
      gradient.stops.length < 2 ||
      gradient.stops.length > 12 ||
      !gradient.stops.every(
        (s) =>
          record(s) &&
          typeof s.color === "string" &&
          inRange(s.position, 0, 100)
      ))
  )
    throw new Error("Theme gradient is invalid.")
  if (
    theme.logo &&
    (!asset(theme.logo.url) ||
      !oneOf(theme.logo.position, [
        "top-left",
        "top-right",
        "bottom-left",
        "bottom-right",
      ]) ||
      !inRange(theme.logo.size, 1, 1000) ||
      !inRange(theme.logo.margin, 0, 1000) ||
      !inRange(theme.logo.opacity, 0, 1))
  )
    throw new Error("Theme logo is invalid.")
  if (
    theme.reference.standalone &&
    (!oneOf(theme.reference.standalone.anchor, [
      "top-left",
      "top-center",
      "top-right",
      "bottom-left",
      "bottom-center",
      "bottom-right",
    ]) ||
      !inRange(theme.reference.standalone.margin, 0, 1000))
  )
    throw new Error("Reference placement is invalid.")
  for (const effect of [theme.verseText.shadow, theme.verseText.outline]) {
    if (
      effect &&
      (!record(effect) ||
        typeof effect.color !== "string" ||
        !Object.values(effect).every(
          (v) => typeof v === "string" || inRange(v, -100, 100)
        ))
    )
      throw new Error("Theme text effect is invalid.")
  }
  if (
    !inRange(theme.textBox.opacity, 0, 1) ||
    !inRange(theme.textBox.padding, 0, 100) ||
    !inRange(theme.textBox.borderRadius, 0, 100) ||
    typeof theme.textBox.color !== "string" ||
    !inRange(theme.verseNumbers.fontSize, 1, 300) ||
    typeof theme.verseNumbers.color !== "string" ||
    !oneOf(theme.divider.style, ["none", "line", "dots"]) ||
    !inRange(theme.divider.opacity, 0, 1) ||
    !inRange(theme.divider.width, 0, 1000) ||
    !inRange(theme.divider.dotCount, 0, 20) ||
    !inRange(theme.divider.dotSize, 0, 100)
  )
    throw new Error("Theme decoration is invalid.")
  if (theme.reference.position === "inline") theme.reference.position = "below"
  if (
    theme.verseText.minFontSize !== undefined &&
    !inRange(theme.verseText.minFontSize, 8, 300)
  )
    throw new Error("Minimum text size is invalid.")
  if (
    theme.layout.referenceGap !== undefined &&
    !inRange(theme.layout.referenceGap, 0, 1000)
  )
    throw new Error("Reference gap is invalid.")
  return constrainThemeLayout(theme)
}

export function constrainThemeLayout(theme: BroadcastTheme): BroadcastTheme {
  const { layout, resolution } = theme
  const w =
    (resolution.width * layout.backgroundWidth * layout.textAreaWidth) / 10000
  const h =
    (resolution.height * layout.backgroundHeight * layout.textAreaHeight) /
    10000
  const box = theme.textBox.enabled ? Math.max(0, theme.textBox.padding) : 0
  const pair = (a: number, b: number, extent: number) => {
    const max = Math.max(0, extent - Math.min(box * 2, extent - 1) - 1)
    const first = Math.min(Math.max(0, Number.isFinite(a) ? a : 0), max)
    return [
      first,
      Math.min(Math.max(0, Number.isFinite(b) ? b : 0), max - first),
    ]
  }
  const [left, right] = pair(layout.padding.left, layout.padding.right, w)
  const [top, bottom] = pair(layout.padding.top, layout.padding.bottom, h)
  return {
    ...theme,
    verseText: {
      ...theme.verseText,
      minFontSize:
        theme.verseText.minFontSize === undefined
          ? undefined
          : Math.min(theme.verseText.fontSize, theme.verseText.minFontSize),
    },
    layout: { ...layout, padding: { left, right, top, bottom } },
  }
}

export function themeHasChanges(
  draft: BroadcastTheme | null,
  saved?: BroadcastTheme
) {
  if (!draft) return false
  if (!saved) return true
  const equal = (a: unknown, b: unknown): boolean => {
    if (a === b) return true
    if (Array.isArray(a) && Array.isArray(b))
      return (
        a.length === b.length &&
        a.every((value, index) => equal(value, b[index]))
      )
    if (!record(a) || !record(b)) return false
    const keys = (value: Record<string, unknown>) =>
      Object.keys(value).filter(
        (key) => key !== "updatedAt" && value[key] !== undefined
      )
    const ak = keys(a),
      bk = keys(b)
    return (
      ak.length === bk.length &&
      ak.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]))
    )
  }
  return !equal(draft, saved)
}
