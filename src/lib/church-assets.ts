import { convertFileSrc, invoke } from "@tauri-apps/api/core"

// Historical keys remain stable in saved plans and session galleries. The
// artwork itself belongs to the device, never to the public installer.
export const PRIVATE_ASSET_FALLBACKS: Record<string, string> = {
  "/EWC-White.png": "/manna-logo.png",
  "/MOMO111.png": "/service-slides/giving-placeholder.svg",
  "/service-slides/momo.png": "/service-slides/giving-placeholder.svg",
  "/service-slides/ewc-adenta-welcome.png":
    "/service-slides/welcome-neutral.svg",
  "/service-slides/welcome-motion.png": "/service-slides/welcome-neutral.svg",
  "/service-slides/closing-pastor-motion.png":
    "/service-slides/closing-neutral.svg",
  "/service-slides/jesus-motion.png": "/service-slides/jesus-neutral.svg",
  "/service-slides/jesus-atmosphere.png": "/service-slides/jesus-neutral.svg",
  "/service-slides/pastor-john-kennedy.png":
    "/service-slides/starburst-black.png",
  "/service-slides/pastor-john-kennedy-starburst.png":
    "/service-slides/starburst-black.png",
}
let localAssets: Record<string, string> = {}
export function setChurchAssets(assets: Record<string, string>) {
  localAssets = Object.fromEntries(
    Object.entries(assets).filter(
      ([key, path]) =>
        Object.hasOwn(PRIVATE_ASSET_FALLBACKS, key) &&
        typeof path === "string" &&
        path.length > 0
    )
  )
}
export function resolveChurchAsset(url: string) {
  if (hasChurchAsset(url)) return convertFileSrc(localAssets[url])
  return Object.hasOwn(PRIVATE_ASSET_FALLBACKS, url)
    ? PRIVATE_ASSET_FALLBACKS[url]
    : url
}
export function hasChurchAsset(url: string) {
  return Object.hasOwn(localAssets, url) && Boolean(localAssets[url])
}
export async function initializeChurchAssets() {
  try {
    setChurchAssets(
      await invoke<Record<string, string>>("get_private_church_assets")
    )
  } catch {
    setChurchAssets({})
  }
}
