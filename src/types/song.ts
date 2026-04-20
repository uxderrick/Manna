export type SongSource = "ghs" | "genius" | "custom"

export type LineMode = "line" | "stanza-pair" | "stanza-full"

export interface SongStanza {
  id: string
  kind: "verse" | "chorus"
  lines: string[]
}

export interface Song {
  id: string
  source: SongSource
  number: number | null
  title: string
  author: string | null
  stanzas: SongStanza[]
  chorus: SongStanza | null
  autoChorus: boolean
  lineMode: LineMode
}

export interface GeniusHit {
  id: number
  title: string
  url: string
  artist: string
  thumbnailUrl: string | null
}

export const GHS_SEED_VERSION = 1
