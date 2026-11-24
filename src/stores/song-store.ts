import { invoke } from "@tauri-apps/api/core"
import { create } from "zustand"
import type {
  GeniusHit,
  LineMode,
  LrclibHit,
  OnlineHit,
  Song,
  SongSource,
} from "@/types"

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
  createdAt?: string
}

/** Parse SQLite's `datetime('now')` output (`"YYYY-MM-DD HH:MM:SS"`, UTC) into
 *  epoch ms. Don't append `Z` if the row already carries a timezone marker —
 *  rare in current code paths but guards future writers (manual SQL,
 *  imports) that may stamp local time. */
function parseCreatedAt(raw: string): number {
  const trimmed = raw.trim()
  const iso = trimmed.replace(" ", "T")
  const hasTz = /([Zz]|[+-]\d{2}:?\d{2})$/.test(iso)
  return Date.parse(hasTz ? iso : `${iso}Z`) || 0
}

function rowToSong(row: SongRowRpc): Song | null {
  let inner: {
    stanzas: Song["stanzas"]
    chorus: Song["chorus"]
    autoChorus: boolean
    lineMode: LineMode
  }
  try {
    inner = JSON.parse(row.data)
  } catch (err) {
    console.warn("[song-store] dropping corrupt row", row.id, err)
    return null
  }
  if (!inner || !Array.isArray(inner.stanzas)) {
    console.warn("[song-store] dropping malformed row", row.id)
    return null
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
    lineMode: inner.lineMode ?? "stanza-pair",
    tune: row.tune ?? null,
    meter: row.meter ?? null,
    scriptureRef: row.scriptureRef ?? null,
    category: row.category ?? null,
    createdAt: row.createdAt ? parseCreatedAt(row.createdAt) : 0,
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

export interface OnlinePreview {
  importId: string
  title: string
  author: string
  stanzas: import("@/types").SongStanza[]
  chorus: import("@/types").SongStanza | null
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
  lrclibSearch: (query: string) => Promise<LrclibHit[]>
  lrclibImport: (hit: LrclibHit) => Promise<Song>
  onlineSearch: (query: string) => Promise<OnlineHit[]>
  previewOnlineHit: (hit: OnlineHit) => Promise<OnlinePreview>
}

export function onlineHitImportId(hit: OnlineHit): string {
  return hit.provider === "genius" ? `genius-${hit.hit.id}` : `lrclib-${hit.hit.id}`
}

export const useSongStore = create<SongStore>((set, get) => ({
  songs: [],
  loading: false,

  hydrateSongs: async () => {
    set({ loading: true })
    try {
      const rows = await invoke<SongRowRpc[]>("list_songs")
      set({ songs: rows.map(rowToSong).filter((s): s is Song => s !== null) })
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
      createdAt: Date.now(),
      id: `genius-${hit.id}`,
      source: "genius",
      number: null,
      title: hit.title,
      author: hit.artist,
      stanzas,
      chorus,
      autoChorus: Boolean(chorus),
      lineMode: "stanza-pair",
      tune: null,
      meter: null,
      scriptureRef: null,
      category: null,
    }
    await get().saveSong(song)
    return song
  },

  lrclibSearch: async (query) => {
    return invoke<LrclibHit[]>("search_lrclib", { query })
  },

  lrclibImport: async (hit) => {
    const lyrics = await invoke<{ plainLyrics: string | null; syncedLyrics: string | null }>(
      "fetch_lrclib_lyrics",
      { id: hit.id },
    )
    const raw = lyrics.plainLyrics ?? (lyrics.syncedLyrics ? stripLrcTimestamps(lyrics.syncedLyrics) : null)
    if (!raw || raw.trim().length === 0) {
      throw new Error("LRCLIB returned no lyrics — paste manually.")
    }
    const { stanzas, chorus } = parsePlainLyrics(raw)
    if (stanzas.length === 0 && !chorus) {
      throw new Error("Could not parse LRCLIB lyrics — paste manually.")
    }
    const song: Song = {
      createdAt: Date.now(),
      id: `lrclib-${hit.id}`,
      source: "lrclib",
      number: null,
      title: hit.trackName,
      author: hit.artistName,
      stanzas,
      chorus,
      autoChorus: Boolean(chorus),
      lineMode: "stanza-pair",
      tune: null,
      meter: null,
      scriptureRef: null,
      category: null,
    }
    await get().saveSong(song)
    return song
  },

  previewOnlineHit: async (hit) => {
    if (hit.provider === "genius") {
      const lyrics = await invoke<string>("fetch_genius_lyrics", { url: hit.hit.url })
      const { stanzas, chorus } = parseGeniusLyrics(lyrics)
      if (stanzas.length === 0 && !chorus) {
        throw new Error("No stanzas parsed from Genius — paste manually.")
      }
      return {
        importId: `genius-${hit.hit.id}`,
        title: hit.hit.title,
        author: hit.hit.artist,
        stanzas,
        chorus,
      }
    }
    const lyrics = await invoke<{ plainLyrics: string | null; syncedLyrics: string | null }>(
      "fetch_lrclib_lyrics",
      { id: hit.hit.id },
    )
    const raw = lyrics.plainLyrics ?? (lyrics.syncedLyrics ? stripLrcTimestamps(lyrics.syncedLyrics) : null)
    if (!raw || raw.trim().length === 0) {
      throw new Error("LRCLIB returned no lyrics — paste manually.")
    }
    const { stanzas, chorus } = parsePlainLyrics(raw)
    if (stanzas.length === 0 && !chorus) {
      throw new Error("Could not parse LRCLIB lyrics — paste manually.")
    }
    return {
      importId: `lrclib-${hit.hit.id}`,
      title: hit.hit.trackName,
      author: hit.hit.artistName,
      stanzas,
      chorus,
    }
  },

  onlineSearch: async (query) => {
    const q = query.trim()
    if (!q) return []
    const [geniusRes, lrclibRes] = await Promise.allSettled([
      get().geniusSearch(q),
      get().lrclibSearch(q),
    ])
    const out: OnlineHit[] = []
    if (geniusRes.status === "fulfilled") {
      for (const hit of geniusRes.value) {
        out.push({
          provider: "genius",
          key: dedupeKey(hit.title, hit.artist),
          title: hit.title,
          artist: hit.artist,
          hit,
        })
      }
    }
    if (lrclibRes.status === "fulfilled") {
      for (const hit of lrclibRes.value) {
        out.push({
          provider: "lrclib",
          key: dedupeKey(hit.trackName, hit.artistName),
          title: hit.trackName,
          artist: hit.artistName,
          hit,
        })
      }
    }
    return mergeOnlineHits(out)
  },
}))

function dedupeKey(title: string, artist: string): string {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "")
  return `${norm(title)}|${norm(artist)}`
}

function mergeOnlineHits(hits: OnlineHit[]): OnlineHit[] {
  const seen = new Map<string, OnlineHit>()
  for (const h of hits) {
    const existing = seen.get(h.key)
    if (!existing) {
      seen.set(h.key, h)
      continue
    }
    // Prefer LRCLIB (free, has timing). Genius keeps slot only when LRCLIB absent.
    if (existing.provider === "genius" && h.provider === "lrclib") {
      seen.set(h.key, h)
    }
  }
  return [...seen.values()]
}

function stripLrcTimestamps(synced: string): string {
  return synced
    .split("\n")
    .map((line) => line.replace(/^\s*\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]\s*/g, ""))
    .join("\n")
}

function parsePlainLyrics(raw: string): ParsedLyrics {
  // LRCLIB plain lyrics typically have no [Verse]/[Chorus] markers — split on
  // blank lines into verses. If markers exist, reuse Genius parser.
  if (/\[[^\]]+\]/.test(raw)) return parseGeniusLyrics(raw)

  const blocks = raw
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0)

  // Flat-block fallback: source lacks blank-line stanza breaks but is long
  // enough that splitting by repeating line runs is worth attempting.
  if (blocks.length <= 1) {
    const allLines = raw.split("\n").map((l) => l.trim()).filter(Boolean)
    if (allLines.length >= 12) {
      const inferred = inferStanzasByRepetition(allLines)
      if (inferred) return inferred
    }
  }

  const stanzas: import("@/types").SongStanza[] = []
  let chorus: import("@/types").SongStanza | null = null
  let verseIdx = 0
  const blockKey = (lines: string[]) => lines.join("\n").toLowerCase()
  const counts = new Map<string, number>()
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean)
    if (lines.length === 0) continue
    counts.set(blockKey(lines), (counts.get(blockKey(lines)) ?? 0) + 1)
  }
  // Block that repeats verbatim 2+ times is treated as chorus.
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean)
    if (lines.length === 0) continue
    const key = blockKey(lines)
    if (!chorus && (counts.get(key) ?? 0) >= 2) {
      chorus = { id: "ch", kind: "chorus", lines }
      continue
    }
    if (chorus && blockKey(chorus.lines) === key) continue
    verseIdx += 1
    stanzas.push({ id: `v${verseIdx}`, kind: "verse", lines })
  }

  return { stanzas, chorus }
}

/**
 * When source lyrics arrive as a single flat block with no blank-line stanza
 * breaks (common for some LRCLIB entries), find the longest contiguous line
 * sequence that repeats verbatim ≥2 times and treat it as the chorus. Runs
 * between chorus occurrences become verses.
 */
function inferStanzasByRepetition(lines: string[]): ParsedLyrics | null {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim()
  const normalized = lines.map(normalize)
  const n = lines.length
  const maxLen = Math.min(8, Math.floor(n / 2))

  for (let len = maxLen; len >= 3; len--) {
    const buckets = new Map<string, number[]>()
    for (let i = 0; i + len <= n; i++) {
      const key = normalized.slice(i, i + len).join("\n")
      if (!key.replace(/[\s\n]/g, "")) continue
      const list = buckets.get(key) ?? []
      list.push(i)
      buckets.set(key, list)
    }

    let best: number[] | null = null
    for (const positions of buckets.values()) {
      const picked: number[] = []
      let lastEnd = -1
      for (const p of positions) {
        if (p >= lastEnd) {
          picked.push(p)
          lastEnd = p + len
        }
      }
      if (picked.length >= 2 && (!best || picked.length > best.length)) {
        best = picked
      }
    }

    if (best) {
      const chorusLines = lines.slice(best[0], best[0] + len)
      const chorus: import("@/types").SongStanza = { id: "ch", kind: "chorus", lines: chorusLines }
      const stanzas: import("@/types").SongStanza[] = []
      let cursor = 0
      let verseIdx = 0
      for (const start of best) {
        if (start > cursor) {
          const verseLines = lines.slice(cursor, start)
          if (verseLines.length > 0) {
            verseIdx += 1
            stanzas.push({ id: `v${verseIdx}`, kind: "verse", lines: verseLines })
          }
        }
        cursor = start + len
      }
      if (cursor < n) {
        const tail = lines.slice(cursor)
        if (tail.length > 0) {
          verseIdx += 1
          stanzas.push({ id: `v${verseIdx}`, kind: "verse", lines: tail })
        }
      }
      return { stanzas, chorus }
    }
  }

  return null
}

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

function stripGeniusPreamble(raw: string): string {
  return raw
    .split("\n")
    .map((line) => line.replace(/^\s*\d+\s*Contributors\s*/i, ""))
    .filter((line) => {
      const t = line.trim()
      if (/^Read More\s*$/i.test(t)) return false
      if (/^Translations(\s|$)/i.test(t)) return false
      return true
    })
    .join("\n")
    .replace(/^[\s\n]+/, "")
}

export function parseGeniusLyrics(input: string): ParsedLyrics {
  const raw = stripGeniusPreamble(input)
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
