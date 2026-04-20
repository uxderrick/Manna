import { expandSong } from "./song-expand"
import { songMeta } from "./song-meta"
import type { QueueItem, Song, VerseRenderData } from "@/types"

/**
 * Convert a song-stanza queue item to VerseRenderData for the canvas renderer.
 * Returns null if the referenced song/stanza no longer exists.
 */
export function songStanzaToRenderData(
  item: Extract<QueueItem, { kind: "song-stanza" }>,
  song: Song | undefined,
): VerseRenderData | null {
  if (!song) return null

  const expanded = expandSong(song).find(
    (e) => e.stanzaRefId === item.stanzaId,
  )
  if (!expanded) return null

  const stanza =
    expanded.kind === "chorus"
      ? song.chorus
      : song.stanzas.find((s) => s.id === item.stanzaId)
  if (!stanza) return null

  const verseIdx =
    stanza.kind === "verse"
      ? song.stanzas.findIndex((s) => s.id === stanza.id)
      : 0

  return {
    reference: songMeta(song, stanza, verseIdx),
    segments: [{ text: expanded.text }],
  }
}
