import { invoke } from "@tauri-apps/api/core"
import { create } from "zustand"
import type { GeniusHit, LineMode, Song, SongSource } from "@/types"

interface SongRowRpc {
  id: string
  source: string
  number: number | null
  title: string
  author: string | null
  data: string
  tune?: string | null
  meter?: string | null
  scriptureRef?: string | null
  category?: string | null
}

function rowToSong(row: SongRowRpc): Song {
  const inner = JSON.parse(row.data) as {
    stanzas: Song["stanzas"]
    chorus: Song["chorus"]
    autoChorus: boolean
    lineMode: LineMode
  }
  return {
    id: row.id,
    source: row.source as SongSource,
    number: row.number,
    title: row.title,
    author: row.author,
    stanzas: inner.stanzas,
    chorus: inner.chorus,
    autoChorus: inner.autoChorus,
    lineMode: inner.lineMode,
    tune: row.tune ?? null,
    meter: row.meter ?? null,
    scriptureRef: row.scriptureRef ?? null,
    category: row.category ?? null,
  }
}

function songToRpc(song: Song): {
  id: string
  source: string
  number: number | null
  title: string
  author: string | null
  data: string
} {
  return {
    id: song.id,
    source: song.source,
    number: song.number,
    title: song.title,
    author: song.author,
    data: JSON.stringify({
      stanzas: song.stanzas,
      chorus: song.chorus,
      autoChorus: song.autoChorus,
      lineMode: song.lineMode,
    }),
  }
}

interface SongStore {
  songs: Song[]
  loading: boolean
  hydrateSongs: () => Promise<void>
  saveSong: (song: Song) => Promise<void>
  deleteSong: (id: string) => Promise<void>
  getSong: (id: string) => Song | undefined
  setAutoChorus: (id: string, on: boolean) => Promise<void>
  setLineMode: (id: string, mode: LineMode) => Promise<void>
  geniusSearch: (query: string) => Promise<GeniusHit[]>
  geniusImport: (hit: GeniusHit) => Promise<Song>
}

export const useSongStore = create<SongStore>((set, get) => ({
  songs: [],
  loading: false,

  hydrateSongs: async () => {
    set({ loading: true })
    try {
      const rows = await invoke<SongRowRpc[]>("list_songs")
      set({ songs: rows.map(rowToSong) })
    } catch (e) {
      console.warn("[songs] hydrate failed:", e)
    } finally {
      set({ loading: false })
    }
  },

  saveSong: async (song) => {
    await invoke("save_song", songToRpc(song))
    set((s) => ({
      songs: s.songs.some((x) => x.id === song.id)
        ? s.songs.map((x) => (x.id === song.id ? song : x))
        : [...s.songs, song],
    }))
  },

  deleteSong: async (id) => {
    await invoke("delete_song", { id })
    set((s) => ({ songs: s.songs.filter((x) => x.id !== id) }))
  },

  getSong: (id) => get().songs.find((s) => s.id === id),

  setAutoChorus: async (id, on) => {
    const song = get().songs.find((s) => s.id === id)
    if (!song) return
    await get().saveSong({ ...song, autoChorus: on })
  },

  setLineMode: async (id, mode) => {
    const song = get().songs.find((s) => s.id === id)
    if (!song) return
    await get().saveSong({ ...song, lineMode: mode })
  },

  geniusSearch: async (query) => {
    const { useSettingsStore } = await import("./settings-store")
    const token = useSettingsStore.getState().geniusToken ?? ""
    return invoke<GeniusHit[]>("search_genius", { token, query })
  },

  geniusImport: async (hit) => {
    const lyrics = await invoke<string>("fetch_genius_lyrics", { url: hit.url })
    const { stanzas, chorus } = parseGeniusLyrics(lyrics)

    if (stanzas.length === 0 && !chorus) {
      throw new Error("No stanzas parsed from Genius — paste manually.")
    }

    const song: Song = {
      id: `genius-${hit.id}`,
      source: "genius",
      number: null,
      title: hit.title,
      author: hit.artist,
      stanzas,
      chorus,
      autoChorus: Boolean(chorus),
      lineMode: "stanza-full",
      tune: null,
      meter: null,
      scriptureRef: null,
      category: null,
    }
    await get().saveSong(song)
    return song
  },
}))

// ── Genius lyrics parser ──────────────────────────────────────────────────
//
// Genius lyrics HTML renders as flat text like:
//   "35 Contributors Amazing Grace Lyrics...Read More [Verse 1]
//    Amazing Grace, how sweet the sound
//    ...
//    [Chorus]
//    'Twas grace..."
//
// Strategy: drop header junk before first `[...]` marker, then split on `[...]`
// headers. Sections whose header matches Chorus/Refrain/Bridge go to `chorus`
// (first occurrence wins); everything else is a verse.

const CHORUS_HEADER_RE = /^\s*(chorus|refrain|pre-chorus|pre chorus)\b/i
// Only recognize section markers that name a known song-structure role. This
// prevents promotional preamble text containing `[Intro]`, `[Produced by …]`,
// or `[Spoken]` from being mistaken for song content.
const SECTION_HEADER_RE =
  /^\s*(verse|chorus|refrain|pre-chorus|pre chorus|bridge|outro|intro|hook|interlude)\b/i

interface ParsedLyrics {
  stanzas: import("@/types").SongStanza[]
  chorus: import("@/types").SongStanza | null
}

export function parseGeniusLyrics(raw: string): ParsedLyrics {
  // Strip header junk by locating the first *song-structure* marker — not
  // just any `[...]` token, which could match promotional preamble.
  const songMarker = raw.match(
    /\[\s*(?:verse|chorus|refrain|pre-chorus|pre chorus|bridge|outro|intro|hook|interlude)\b[^\]]*\]/i,
  )
  const firstBracket = songMarker?.index ?? raw.search(/\[[^\]]+\]/)
  const body = firstBracket !== undefined && firstBracket >= 0 ? raw.slice(firstBracket) : raw

  // Split on `[Header]` markers, keeping them as delimiters.
  const parts = body.split(/\[([^\]]+)\]/g)
  // split result: [preamble, header1, body1, header2, body2, ...]
  const stanzas: import("@/types").SongStanza[] = []
  let chorus: import("@/types").SongStanza | null = null
  let verseIdx = 0

  for (let i = 1; i < parts.length; i += 2) {
    const header = parts[i] ?? ""
    const section = (parts[i + 1] ?? "").trim()
    if (!section) continue

    const lines = section
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
    if (lines.length === 0) continue

    // Skip sections whose header isn't a known song-structure role (drops
    // e.g. `[Produced by X]` or other promotional metadata brackets).
    if (!SECTION_HEADER_RE.test(header)) continue

    if (CHORUS_HEADER_RE.test(header) && !chorus) {
      chorus = { id: "ch", kind: "chorus", lines }
    } else if (CHORUS_HEADER_RE.test(header)) {
      // Subsequent chorus/refrain markers — skip, first wins
      continue
    } else {
      verseIdx += 1
      stanzas.push({ id: `v${verseIdx}`, kind: "verse", lines })
    }
  }

  // Fallback: if no bracket markers present, split on blank lines.
  if (stanzas.length === 0 && !chorus) {
    const blocks = raw
      .split(/\n{2,}/)
      .map((b) => b.trim())
      .filter((b) => b.length > 0)
    blocks.forEach((block, i) => {
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean)
      if (lines.length > 0) {
        stanzas.push({ id: `v${i + 1}`, kind: "verse", lines })
      }
    })
  }

  return { stanzas, chorus }
}
