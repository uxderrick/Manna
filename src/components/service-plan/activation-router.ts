// src/components/service-plan/activation-router.ts
import { useBroadcastStore, useBibleStore } from "@/stores"
import { parsePlanItem } from "@/types"
import type { PlanItem } from "@/types"

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
      broadcast.setLiveVerse(null)
      return

    case "verse": {
      const bible = useBibleStore.getState()
      const translation = bible.translations.find((t) => t.id === parsed.translationId)
      const abbreviation = translation?.abbreviation ?? "KJV"
      broadcast.setLiveVerse({
        reference: `${parsed.bookName} ${parsed.chapter}:${parsed.verse} (${abbreviation})`,
        segments: [{ text: parsed.verseText, verseNumber: parsed.verse }],
      })
      return
    }

    case "announcement": {
      broadcast.setLiveVerse({
        reference: parsed.title,
        segments: [{ text: parsed.body }],
      })
      return
    }

    case "song": {
      // Songs tab owns its own render pipeline. Emit a DOM event so a
      // future integration point picks it up without coupling stores here.
      window.dispatchEvent(
        new CustomEvent("plan:activate-song", { detail: { songId: parsed.songId } }),
      )
      return
    }
  }
}
