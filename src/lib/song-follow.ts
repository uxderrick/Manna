import type { QueueItem, Song, SongStanza } from "@/types"

/** Where the singing is in the song on screen (backend `song_position`). */
export interface SongPosition {
  songId: string
  /** Index into the song's stanzas as song detection counts them (see `positionStanzas`). */
  stanza: number
  /** Line of that stanza being sung, and how many lines it has. */
  line: number
  lines: number
  score: number
  confident: boolean
}

export type FollowMode = "auto" | "suggest" | "off"

type SongSlide = Extract<QueueItem, { kind: "song-stanza" }>

/** Stanzas in song detection's order: verses with words, then the chorus. */
export function positionStanzas(song: Song): SongStanza[] {
  const withWords = (s: SongStanza | null): s is SongStanza => s !== null && s.lines.some((l) => l.trim() !== "")
  return [...song.stanzas.filter(withWords), ...(withWords(song.chorus) ? [song.chorus] : [])]
}

/** The song whose slide is active in the queue, if any. */
export function activeSongId(items: QueueItem[], activeIndex: number | null): string | null {
  const item = activeIndex === null ? undefined : items[activeIndex]
  return item?.kind === "song-stanza" ? item.songId : null
}

/** Name for a stanza, as an operator would say it. */
export function stanzaLabel(song: Song, stanzaId: string): string {
  if (song.chorus?.id === stanzaId) return "Chorus"
  const i = song.stanzas.findIndex((s) => s.id === stanzaId)
  return i < 0 ? "Verse" : `Verse ${i + 1}`
}

function linesPerSlide(song: Song, stanza: SongStanza): number {
  switch (song.lineMode) {
    case "line":
      return 1
    case "stanza-pair":
      return 2
    default:
      return Math.max(1, stanza.lines.length)
  }
}

/**
 * The queue slide to show for a sung position, within the block of slides
 * of the song that is active (choruses repeat, long stanzas span slides).
 *
 * Speech recognition runs a few seconds behind the singers, so by default
 * once the last line on a slide is heard the next slide is chosen
 * (`lookAhead`): they are already singing it.
 */
export function slideFor(
  items: QueueItem[],
  activeIndex: number,
  song: Song,
  position: Pick<SongPosition, "stanza" | "line">,
  lookAhead = true,
): number | null {
  const isSlide = (i: number) => {
    const it = items[i]
    return it?.kind === "song-stanza" && it.songId === song.id
  }
  if (!isSlide(activeIndex)) return null
  let first = activeIndex
  while (isSlide(first - 1)) first--
  let last = activeIndex
  while (isSlide(last + 1)) last++

  const stanza = positionStanzas(song)[position.stanza]
  if (!stanza) return null
  // Each place this stanza appears in the block (a chorus appears after every verse).
  const runs: Array<[number, number]> = []
  for (let i = first; i <= last; i++) {
    if ((items[i] as SongSlide).stanzaId !== stanza.id) continue
    const run = runs[runs.length - 1]
    if (run && run[1] === i - 1) run[1] = i
    else runs.push([i, i])
  }
  if (runs.length === 0) return null
  // Stay in the run being shown; else the next one ahead; else the last one before.
  const run =
    runs.find(([a, b]) => activeIndex >= a && activeIndex <= b) ??
    runs.find(([a]) => a > activeIndex) ??
    runs[runs.length - 1]

  const per = linesPerSlide(song, stanza)
  const chunk = Math.floor(position.line / per)
  const slide = Math.min(run[0] + chunk, run[1])
  const lastOnSlide = (position.line + 1) % per === 0 || position.line >= stanza.lines.length - 1
  if (lookAhead && lastOnSlide && slide + 1 <= last) return slide + 1
  return slide
}

/** How following moves the slides: forward on one sure position, back only on two in a row. */
export function shouldMove(target: number, active: number, previousTarget: number | null): boolean {
  if (target === active) return false
  if (target > active) return true
  return previousTarget === target
}
