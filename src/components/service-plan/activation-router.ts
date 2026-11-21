import { markPlanItemPresented } from "./(lib)/presentation"
import { prayerImageSlide } from "./(lib)/prayer-slide"
// src/components/service-plan/activation-router.ts
import {
  useBroadcastStore,
  useBibleStore,
  useQueueStore,
  useSettingsStore,
} from "@/stores"
import { givingSlide } from "@/lib/giving-slide"
import { resolveBrandAsset } from "@/lib/brand"
import { parsePlanItem } from "@/types"
import type { PlanItem } from "@/types"
import { openNotesSelectionDrawer } from "@/lib/notes-selection-drawer"
import { useAnnouncementDialogStore } from "@/lib/announcement-dialog"

/**
 * Route a PlanItem to the right broadcast primitive.
 * - verse       → setLiveVerse with assembled VerseRenderData
 * - announcement → setLiveVerse reusing the live-verse primitive (title + body)
 * - song        → DOM CustomEvent (Songs tab owns its own render pipeline)
 * - section     → no-op (visual divider only)
 * - blank/corrupt → setLiveVerse(null)  ← clears the display
 */
export function activatePlanItem(item: PlanItem): void {
  const parsed = parsePlanItem(item)
  const before = useBroadcastStore.getState().liveVerse
  routePlanItem(item)
  if (
    !parsed ||
    parsed.type === "section" ||
    parsed.type === "announcement" ||
    parsed.type === "notes"
  )
    return
  if (
    parsed.type === "song" &&
    useBroadcastStore.getState().liveVerse === before
  )
    return
  markPlanItemPresented(item.id)
}

function routePlanItem(item: PlanItem): void {
  const parsed = parsePlanItem(item)
  const broadcast = useBroadcastStore.getState()

  // Corrupt JSON → treat as blank
  if (parsed == null) {
    broadcast.setLiveVerse(null)
    return
  }

  switch (parsed.type) {
    case "section":
      // Visual divider — no broadcast action
      return

    case "blank":
      if (parsed.prayer) {
        broadcast.setFullscreenImage(prayerImageSlide(item.id, parsed.prayer))
      } else if (parsed.imageUrl) {
        broadcast.setFullscreenImage({
          url: parsed.imageUrl,
          label: parsed.imageLabel ?? "",
          ...(parsed.mediaType ? { mediaType: parsed.mediaType, poster: parsed.poster } : {}),
          ...(parsed.textOverlay ? { textOverlay: parsed.textOverlay } : {}),
        })
      } else if (parsed.showLogo) {
        broadcast.setLiveVerse(null)
        broadcast.setBlankLogo(true)
      } else {
        broadcast.setLiveVerse(null)
        broadcast.setBlankLogo(false)
      }
      return

    case "verse": {
      const bible = useBibleStore.getState()
      const translation = bible.translations.find(
        (t) => t.id === parsed.translationId
      )
      const abbreviation = translation?.abbreviation ?? "KJV"
      broadcast.setLiveVerse({
        reference: `${parsed.bookName} ${parsed.chapter}:${parsed.verse} (${abbreviation})`,
        segments: [{ text: parsed.verseText, verseNumber: parsed.verse }],
      })
      return
    }

    case "announcement": {
      // Open the announcement edit dialog instead of pushing live immediately,
      // so the operator can review/tweak then hit "Go Live" inside the dialog.
      useAnnouncementDialogStore.getState().openAnnouncementForEdit(item)
      return
    }

    case "song": {
      useQueueStore.getState().presentSongLive(parsed.songId)
      return
    }

    case "momo": {
      const brand = useSettingsStore.getState().brand
      broadcast.setFullscreenImage(givingSlide(brand))
      return
    }

    case "jesus": {
      const brand = useSettingsStore.getState().brand
      broadcast.setFullscreenImage({
        url: resolveBrandAsset("jesus", brand.jesusImagePath),
        label: "Jesus",
      })
      return
    }

    case "notes": {
      openNotesSelectionDrawer(item.id)
      return
    }
  }
}
