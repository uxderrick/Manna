import { setChurchAssets } from "@/lib/church-assets"
import { beforeEach as beforePrivatePack } from "vitest"
beforePrivatePack(() => setChurchAssets({ "/service-slides/pastor-john-kennedy-starburst.png": "/managed/portrait.png", "/EWC-White.png": "/managed/logo.png" }))
import { expect, it } from "vitest"
import type { ImageSlide } from "@/types"
import {
  getSpeakerPortraitUrl,
  DEFAULT_SPEAKER_NAME,
  DEFAULT_SPEAKER_PORTRAIT,
} from "./speaker-portrait"
import { IMAGE_TEXT_PRESETS } from "@/components/service-plan/(lib)/image-text-slide"

const slide: ImageSlide = {
  url: "/background.png",
  label: "Title",
  textOverlay: { layout: "title", title: "Faith", body: DEFAULT_SPEAKER_NAME },
}
it("links the default service title to Pastor John Kennedy's portrait", () => {
  expect(IMAGE_TEXT_PRESETS[0].textOverlay?.body).toBe(DEFAULT_SPEAKER_NAME)
  expect(getSpeakerPortraitUrl(slide)).toBe(DEFAULT_SPEAKER_PORTRAIT)
})
it("accepts capitalization and whitespace changes to the same name", () => {
  expect(
    getSpeakerPortraitUrl({
      ...slide,
      textOverlay: { ...slide.textOverlay!, body: "  PASTOR  JOHN\nKENNEDY " },
    })
  ).toBe(DEFAULT_SPEAKER_PORTRAIT)
})
it.each(["Pastor John", "Pastor Jane Kennedy", "", "Pastor John Kennedy Jr"])(
  "hides the portrait when the name changes to %j",
  (body) => {
    expect(
      getSpeakerPortraitUrl({
        ...slide,
        textOverlay: { ...slide.textOverlay!, body },
      })
    ).toBeUndefined()
  }
)
it("keeps announcement and image-only slides free of the portrait", () => {
  expect(
    getSpeakerPortraitUrl({
      ...slide,
      textOverlay: { ...slide.textOverlay!, layout: "announcement" },
    })
  ).toBeUndefined()
  expect(
    getSpeakerPortraitUrl({ url: slide.url, label: slide.label })
  ).toBeUndefined()
  expect(getSpeakerPortraitUrl(null)).toBeUndefined()
})

it("does not attach a private speaker photo in a fresh installation", () => {
  setChurchAssets({})
  expect(getSpeakerPortraitUrl(slide)).toBeUndefined()
})
