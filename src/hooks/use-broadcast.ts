import { useBroadcastStore } from "@/stores/broadcast-store"
import { useBibleStore } from "@/stores/bible-store"
import { invoke } from "@tauri-apps/api/core"
import type { VerseRenderData } from "@/types"
import type { Verse } from "@/types"

export function toVerseRenderData(verse: Verse, translation: string): VerseRenderData {
  return {
    reference: `${verse.book_name} ${verse.chapter}:${verse.verse} (${translation})`,
    segments: [{ verseNumber: verse.verse, text: verse.text }],
  }
}

export function deriveLiveVerse({
  isLive,
  selectedVerse,
  translation,
}: {
  isLive: boolean
  selectedVerse: Verse | null
  translation: string
}): VerseRenderData | null {
  if (!isLive || !selectedVerse) return null
  return toVerseRenderData(selectedVerse, translation)
}

const parseRef = (ref: string) => {
  const match = ref.match(/^(.+?)\s+(\d+):(\d+)/)
  if (!match) return null
  return { bookName: match[1], chapter: parseInt(match[2]), verse: parseInt(match[3]) }
}

export async function retranslateBroadcastVerses(translationId: number, abbreviation: string) {
  const books = useBibleStore.getState().books
  const broadcast = useBroadcastStore.getState()

  const refetch = async (current: VerseRenderData | null): Promise<VerseRenderData | null> => {
    if (!current) return null
    const parsed = parseRef(current.reference)
    if (!parsed) return null
    const book = books.find(b => b.name === parsed.bookName)
    if (!book) return null
    const v = await invoke<Verse | null>("get_verse", {
      translationId,
      bookNumber: book.book_number,
      chapter: parsed.chapter,
      verse: parsed.verse,
    })
    return v ? toVerseRenderData(v, abbreviation) : null
  }

  const [nextLive, nextPreview] = await Promise.all([
    refetch(broadcast.liveVerse),
    refetch(broadcast.previewVerse),
  ])
  if (nextLive) useBroadcastStore.getState().setLiveVerse(nextLive)
  if (nextPreview) useBroadcastStore.getState().setPreviewVerse(nextPreview)
}

export const broadcastActions = {
  setLiveVerse: (verse: VerseRenderData | null) =>
    useBroadcastStore.getState().setLiveVerse(verse),
  setLive: (live: boolean) =>
    useBroadcastStore.getState().setLive(live),
  getActiveTheme: () => {
    const s = useBroadcastStore.getState()
    return s.themes.find((t) => t.id === s.activeThemeId) ?? s.themes[0]
  },
}
