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
      reference: string
    })
