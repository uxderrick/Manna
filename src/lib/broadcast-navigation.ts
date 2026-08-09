import type { QueueItem, Verse } from "@/types"

export function shouldStepWithinQueue(
  item: QueueItem | undefined,
  currentReference?: string,
  queueReference?: string
): boolean {
  const isQueueSequence =
    item?.kind === "song-stanza" ||
    (item?.kind === "verse" && Boolean(item.chunk))
  const isCurrentQueueItem =
    currentReference === undefined ||
    queueReference === undefined ||
    currentReference === queueReference
  return isQueueSequence && isCurrentQueueItem
}

interface VerseLocation {
  bookNumber: number
  chapter: number
  verse: number
}

interface FindAdjacentBibleVerseInput extends VerseLocation {
  direction: -1 | 1
  maxChapter: number
  fetchVerse: (location: VerseLocation) => Promise<Verse | null>
  fetchChapter: (location: Omit<VerseLocation, "verse">) => Promise<Verse[]>
}

export async function findAdjacentBibleVerse({
  bookNumber,
  chapter,
  verse,
  direction,
  maxChapter,
  fetchVerse,
  fetchChapter,
}: FindAdjacentBibleVerseInput): Promise<Verse | null> {
  const adjacentVerse = verse + direction
  if (adjacentVerse >= 1) {
    const sameChapter = await fetchVerse({
      bookNumber,
      chapter,
      verse: adjacentVerse,
    })
    if (sameChapter) return sameChapter
  }

  if (direction === 1 && chapter < maxChapter) {
    return fetchVerse({ bookNumber, chapter: chapter + 1, verse: 1 })
  }

  if (direction === -1 && chapter > 1) {
    const previousChapter = await fetchChapter({
      bookNumber,
      chapter: chapter - 1,
    })
    return previousChapter.at(-1) ?? null
  }

  return null
}
