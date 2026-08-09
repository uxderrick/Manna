import { queueVerseToRenderData } from "@/hooks/use-broadcast"
import { bibleActions } from "@/hooks/use-bible"
import { useBibleStore, useBroadcastStore, useQueueStore } from "@/stores"
import type { QueueItem, Verse } from "@/types"

function activeTranslationAbbreviation(): string {
  return useBibleStore.getState().translations
    .find((t) => t.id === useBibleStore.getState().activeTranslationId)?.abbreviation ?? "KJV"
}

function queueVerseInput(verse: Verse, confidence = 1): Extract<QueueItem, { kind: "verse" }> {
  return {
    kind: "verse",
    id: crypto.randomUUID(),
    verse,
    reference: `${verse.book_name} ${verse.chapter}:${verse.verse}`,
    confidence,
    source: "manual",
    added_at: Date.now(),
  }
}

function sameVerse(a: Verse, b: Verse): boolean {
  if (a.id !== 0 && b.id !== 0) return a.id === b.id
  return (
    a.translation_id === b.translation_id &&
    a.book_number === b.book_number &&
    a.chapter === b.chapter &&
    a.verse === b.verse
  )
}

function findFirstQueuedVerseIndex(verse: Verse): number {
  return useQueueStore.getState().items.findIndex(
    (item) => item.kind === "verse" && sameVerse(item.verse, verse),
  )
}

export function addOrFindQueuedVerse(verse: Verse, confidence = 1): {
  item: QueueItem | undefined
  index: number
} {
  const queue = useQueueStore.getState()
  const existingIndex = findFirstQueuedVerseIndex(verse)
  if (existingIndex >= 0) {
    return { item: queue.items[existingIndex], index: existingIndex }
  }

  const index = queue.items.length
  const inserted = queue.addItem(queueVerseInput(verse, confidence))
  return { item: inserted[0], index }
}

export function previewQueuedVerse(verse: Verse, confidence = 1): void {
  const { item, index } = addOrFindQueuedVerse(verse, confidence)
  if (!item || item.kind !== "verse") return

  useQueueStore.getState().setActive(index)
  useBroadcastStore.getState().setPreviewVerse(
    queueVerseToRenderData(item, activeTranslationAbbreviation()),
  )
}

export function presentQueuedVerseLive(verse: Verse, confidence = 1): void {
  bibleActions.selectVerse(verse)
  bibleActions.navigateToVerse(verse.book_number, verse.chapter, verse.verse)
  previewQueuedVerse(verse, confidence)
  useBroadcastStore.getState().goLive()
}
