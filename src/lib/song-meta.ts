import type { Song, SongStanza } from "@/types"

export function songMeta(song: Song, stanza: SongStanza, verseIndex: number): string {
  const prefix = song.number ? `Hymn ${song.number}` : song.title
  if (stanza.kind === "chorus") return `${prefix} · Chorus`
  return `${prefix} · Verse ${verseIndex + 1}`
}
