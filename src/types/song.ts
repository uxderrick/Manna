export type SongSource = "ghs" | "mhb" | "sankey" | "sda" | "genius" | "custom"

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
  tune: string | null
  meter: string | null
  scriptureRef: string | null
  category: string | null
}

export interface GeniusHit {
  id: number
  title: string
  url: string
  artist: string
  thumbnailUrl: string | null
}

export const GHS_SEED_VERSION = 1

export const HYMNAL_SOURCES = ["ghs", "mhb", "sankey", "sda"] as const
export type HymnalSource = (typeof HYMNAL_SOURCES)[number]

export const HYMNAL_NAMES: Record<HymnalSource, string> = {
  ghs: "DCLM (GHS)",
  mhb: "Methodist",
  sankey: "Sankey",
  sda: "SDA",
}

export const HYMNAL_BADGES: Record<HymnalSource, string> = {
  ghs: "GHS",
  mhb: "MHB",
  sankey: "SNK",
  sda: "SDA",
}

export function isHymnalSource(s: SongSource): s is HymnalSource {
  return s === "ghs" || s === "mhb" || s === "sankey" || s === "sda"
}
