import { afterEach, expect, it, vi } from "vitest"
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset:${path}`,
}))
import {
  setChurchAssets,
  resolveChurchAsset,
  hasChurchAsset,
} from "./church-assets"
afterEach(() => setChurchAssets({}))
it("uses local artwork for saved legacy image paths without changing their keys", () => {
  setChurchAssets({
    "/service-slides/momo.png": "/managed/church-assets/momo.png",
  })
  expect(resolveChurchAsset("/service-slides/momo.png")).toBe(
    "asset:/managed/church-assets/momo.png"
  )
  expect(hasChurchAsset("/service-slides/momo.png")).toBe(true)
})
it("uses a neutral replacement when private artwork is not installed", () => {
  expect(resolveChurchAsset("/service-slides/momo.png")).toBe(
    "/service-slides/giving-placeholder.svg"
  )
  expect(resolveChurchAsset("/EWC-White.png")).toBe("/manna-logo.png")
  expect(resolveChurchAsset("/service-slides/welcome-motion.png")).toBe(
    "/service-slides/welcome-neutral.svg"
  )
  expect(
    hasChurchAsset("/service-slides/pastor-john-kennedy-starburst.png")
  ).toBe(false)
})
it("keeps uploaded images and unrelated built-in designs unchanged", () => {
  expect(resolveChurchAsset("data:image/png;base64,abc")).toBe(
    "data:image/png;base64,abc"
  )
  expect(resolveChurchAsset("/service-slides/starburst-black.png")).toBe(
    "/service-slides/starburst-black.png"
  )
})

it("does not resolve inherited object properties as assets", () => {
  expect(resolveChurchAsset("constructor")).toBe("constructor")
  expect(hasChurchAsset("toString")).toBe(false)
})
