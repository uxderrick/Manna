import MiniSearch from "minisearch"
import type { Song } from "@/types"

interface IndexDoc {
  id: string
  title: string
  number: string
  author: string
  firstLines: string
  lyrics: string
}

function buildIndex(songs: Song[]): MiniSearch<IndexDoc> {
  const ms = new MiniSearch<IndexDoc>({
    fields: ["title", "number", "author", "firstLines", "lyrics"],
    storeFields: ["id"],
    searchOptions: {
      boost: { title: 4, firstLines: 2, number: 3, author: 1, lyrics: 0.6 },
      prefix: true,
      // Typo tolerance only on longer words: on one or two letters it matches
      // nearly every song's lyrics and costs most of the search.
      fuzzy: (term) => (term.length >= 4 ? 0.2 : false),
      combineWith: "AND",
    },
  })
  const docs: IndexDoc[] = songs.map((s) => ({
    id: s.id,
    title: s.title,
    number: s.number !== null ? String(s.number) : "",
    author: s.author ?? "",
    firstLines: s.stanzas.map((st) => st.lines[0] ?? "").join(" "),
    lyrics: s.stanzas.flatMap((st) => st.lines).join(" "),
  }))
  ms.addAll(docs)
  return ms
}

// One index per songs[] identity (the local list and the EWC Live list
// each keep theirs), so keystrokes and tab switches never rebuild it:
// building takes most of a second for 1,500 songs.
const indexes = new WeakMap<Song[], { index: MiniSearch<IndexDoc>; byId: Map<string, Song> }>()

function getIndex(songs: Song[]) {
  let entry = indexes.get(songs)
  if (!entry) {
    entry = { index: buildIndex(songs), byId: new Map(songs.map((s) => [s.id, s])) }
    indexes.set(songs, entry)
  }
  return entry
}

/** Build the search index ahead of the first keystroke. */
export function warmSongIndex(songs: Song[]): void {
  if (songs.length > 0) getIndex(songs)
}

const PREFIX_RE = /^(ghs|mhb|sankey|snk|sda)\s+(\d+)$/i

export function searchSongs(songs: Song[], query: string): Song[] {
  const q = query.trim()
  if (!q) return songs

  // "<source> <number>" scoped lookup — e.g. "mhb 42", "snk 150".
  const prefixMatch = q.toLowerCase().match(PREFIX_RE)
  if (prefixMatch) {
    const rawSource = prefixMatch[1]
    const source = rawSource === "snk" ? "sankey" : rawSource
    const n = parseInt(prefixMatch[2], 10)
    const direct = songs.find((s) => s.source === source && s.number === n)
    if (direct) return [direct]
  }

  if (/^\d+$/.test(q)) {
    const n = parseInt(q, 10)
    const direct = songs.find((s) => s.source === "ghs" && s.number === n)
    if (direct) {
      const { index, byId } = getIndex(songs)
      const fuzzy = index
        .search(q)
        .map((r) => byId.get(r.id as string))
        .filter((s): s is Song => s !== undefined && s.id !== direct.id)
      return [direct, ...fuzzy]
    }
  }

  const { index, byId } = getIndex(songs)
  return index
    .search(q)
    .map((r) => byId.get(r.id as string))
    .filter((s): s is Song => Boolean(s))
}
