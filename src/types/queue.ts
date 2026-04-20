import type { Verse } from "./bible"

export type QueueItemSource = "manual" | "ai-direct" | "ai-semantic" | "ai-cloud"

interface QueueItemBase {
  id: string
  source: QueueItemSource
  added_at: number
}

export type QueueItem =
  | (QueueItemBase & {
      kind: "verse"
      verse: Verse
      reference: string
      confidence: number
    })
  | (QueueItemBase & {
      kind: "song-stanza"
      songId: string
      stanzaId: string
      /**
       * Index into `expandSong(song)[]` at enqueue time. Stable handle for
       * per-line (`line`/`stanza-pair` lineMode) navigation, where multiple
       * queue items share the same `stanzaId` but point to different line chunks.
       */
      expandedIndex: number
      reference: string
      /** Pre-rendered text for this specific expanded chunk. */
      text: string
    })
