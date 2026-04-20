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
    const stanzas = lyrics
      .split(/\n{2,}/)
      .map((block, i) => ({
        id: `v${i + 1}`,
        kind: "verse" as const,
        lines: block.split("\n").filter((l) => l.trim().length > 0),
      }))
      .filter((s) => s.lines.length > 0)

    if (stanzas.length === 0) {
      throw new Error("No stanzas parsed from Genius — paste manually.")
    }

    const song: Song = {
      id: `genius-${hit.id}`,
      source: "genius",
      number: null,
      title: hit.title,
      author: hit.artist,
      stanzas,
      chorus: null,
      autoChorus: false,
      lineMode: "stanza-full",
    }
    await get().saveSong(song)
    return song
  },
}))
