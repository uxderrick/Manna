import type { Verse } from "./bible"
import type { TextHighlight } from "./broadcast"

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
      highlights?: TextHighlight[]
      /**
       * Present when this row is one slice of a long verse split at enqueue
       * time. Sibling chunks share the same `groupId`. `text` overrides
       * `verse.text` for rendering and preview; `reference` already carries
       * the `(N/M)` suffix.
       */
      chunk?: {
        groupId: string
        index: number
        total: number
        text: string
      }
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
  | (QueueItemBase & {
      kind: "image"
      url: string
      label: string
      thumbnailUrl?: string
      provider: "pexels" | "unsplash" | "local"
    })
