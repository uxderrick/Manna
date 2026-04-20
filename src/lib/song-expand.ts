import type { LineMode, Song, SongStanza } from "@/types"

export interface ExpandedStanzaItem {
  songId: string
  stanzaRefId: string
  kind: "verse" | "chorus"
  text: string
}

export function stanzaToText(stanza: SongStanza): string {
  return stanza.lines.join("\n")
}

function chunkLines(lines: string[], size: number): string[] {
  const out: string[] = []
  for (let i = 0; i < lines.length; i += size) {
    out.push(lines.slice(i, i + size).join("\n"))
  }
  return out
}

function renderStanza(stanza: SongStanza, lineMode: LineMode): string[] {
  switch (lineMode) {
    case "line":
      return [...stanza.lines]
    case "stanza-pair":
      return chunkLines(stanza.lines, 2)
    case "stanza-full":
      return [stanzaToText(stanza)]
  }
}

export function expandSong(song: Song): ExpandedStanzaItem[] {
  const out: ExpandedStanzaItem[] = []
  const includeChorus = song.autoChorus && song.chorus !== null
  const chorusTexts = song.chorus ? renderStanza(song.chorus, song.lineMode) : []

  for (const stanza of song.stanzas) {
    const texts = renderStanza(stanza, song.lineMode)
    for (const text of texts) {
      out.push({ songId: song.id, stanzaRefId: stanza.id, kind: "verse", text })
    }
    if (includeChorus) {
      for (const text of chorusTexts) {
        out.push({ songId: song.id, stanzaRefId: song.chorus!.id, kind: "chorus", text })
      }
    }
  }

  return out
}
