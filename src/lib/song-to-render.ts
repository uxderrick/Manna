import type { QueueItem, Song, VerseRenderData } from "@/types"

/**
 * Convert a song-stanza queue item to VerseRenderData for the canvas renderer.
 *
 * Uses the pre-rendered `text` stored on the queue item at enqueue time (which
 * already accounts for lineMode — `"line"`, `"stanza-pair"`, `"stanza-full"`).
 * This preserves per-line identity: multi-chunk stanzas produce multiple queue
 * items sharing a `stanzaId` but each has its own `expandedIndex` + `text`.
 *
 * Song arg is accepted for future parity (e.g. live song edits regenerating
 * meta), but current implementation only verifies existence.
 */
export function songStanzaToRenderData(
  item: Extract<QueueItem, { kind: "song-stanza" }>,
  song: Song | undefined,
): VerseRenderData | null {
  if (!song) return null
  return {
    reference: item.reference,
    segments: [{ text: item.text }],
  }
}
