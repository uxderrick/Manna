import { HYMNAL_BADGES, isHymnalSource } from "@/types"
import type { Song, SongStanza } from "@/types"

export function songMeta(song: Song, stanza: SongStanza, verseIndex: number): string {
  const prefix =
    isHymnalSource(song.source) && song.number !== null
      ? `${HYMNAL_BADGES[song.source]} ${song.number}`
      : song.title
  if (stanza.kind === "chorus") return `${prefix} · Chorus`
  return `${prefix} · Verse ${verseIndex + 1}`
}
