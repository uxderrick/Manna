import MiniSearch from "minisearch"
import type { Song } from "@/types"

interface IndexDoc {
  id: string
  title: string
  number: string
  author: string
  firstLines: string
}

function buildIndex(songs: Song[]): MiniSearch<IndexDoc> {
  const ms = new MiniSearch<IndexDoc>({
    fields: ["title", "number", "author", "firstLines"],
    storeFields: ["id"],
    searchOptions: {
      boost: { title: 3, firstLines: 1, author: 1, number: 2 },
      prefix: true,
      fuzzy: 0.2,
    },
  })
  const docs: IndexDoc[] = songs.map((s) => ({
    id: s.id,
    title: s.title,
    number: s.number !== null ? String(s.number) : "",
    author: s.author ?? "",
    firstLines: s.stanzas.map((st) => st.lines[0] ?? "").join(" "),
  }))
  ms.addAll(docs)
  return ms
}

export function searchSongs(songs: Song[], query: string): Song[] {
  const q = query.trim()
  if (!q) return songs

  if (/^\d+$/.test(q)) {
    const n = parseInt(q, 10)
    const direct = songs.find((s) => s.source === "ghs" && s.number === n)
    if (direct) {
      const rest = songs.filter((s) => s.id !== direct.id)
      const index = buildIndex(rest)
      const fuzzy = index
        .search(q)
        .map((r) => rest.find((s) => s.id === r.id))
        .filter((s): s is Song => Boolean(s))
      return [direct, ...fuzzy]
    }
  }

  const index = buildIndex(songs)
  return index
    .search(q)
    .map((r) => songs.find((s) => s.id === r.id))
    .filter((s): s is Song => Boolean(s))
}
