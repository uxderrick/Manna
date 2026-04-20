import { create } from "zustand"
import type { QueueItem, Song } from "@/types"
import { expandSong } from "@/lib/song-expand"
import { songMeta } from "@/lib/song-meta"
import { useSongStore } from "./song-store"

interface QueueState {
  items: QueueItem[]
  activeIndex: number | null

  addItem: (item: QueueItem) => void
  removeItem: (id: string) => void
  reorderItems: (fromIndex: number, toIndex: number) => void
  setActive: (index: number | null) => void
  clearQueue: () => void

  enqueueSong: (songId: string) => void
  enqueueSongStanza: (songId: string, stanzaId: string) => void
  jumpLiveSong: (songId: string) => void
  jumpToSongNumber: (num: number) => void
  presentSongLive: (songId: string) => void
}

function stanzaIndexById(song: Song, stanzaId: string): number {
  return song.stanzas.findIndex((s) => s.id === stanzaId)
}

function newQueueId(): string {
  return `song-q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export const useQueueStore = create<QueueState>((set, get) => ({
  items: [],
  activeIndex: null,

  addItem: (item) =>
    set((state) => ({ items: [...state.items, item] })),
  removeItem: (id) =>
    set((state) => ({
      items: state.items.filter((i) => i.id !== id),
    })),
  reorderItems: (fromIndex, toIndex) =>
    set((state) => {
      const items = [...state.items]
      const [moved] = items.splice(fromIndex, 1)
      items.splice(toIndex, 0, moved)
      return { items }
    }),
  setActive: (activeIndex) => set({ activeIndex }),
  clearQueue: () => set({ items: [], activeIndex: null }),

  enqueueSong: (songId) => {
    const song = useSongStore.getState().getSong(songId)
    if (!song) return
    const expanded = expandSong(song)
    const newItems: QueueItem[] = expanded.map((exp, expandedIndex) => {
      const stanza =
        exp.kind === "chorus"
          ? song.chorus!
          : song.stanzas.find((s) => s.id === exp.stanzaRefId)!
      const idx =
        exp.kind === "verse" ? stanzaIndexById(song, exp.stanzaRefId) : 0
      return {
        kind: "song-stanza",
        id: newQueueId(),
        source: "manual",
        added_at: Date.now(),
        songId: song.id,
        stanzaId: exp.stanzaRefId,
        expandedIndex,
        reference: songMeta(song, stanza, idx),
        text: exp.text,
      }
    })
    set((s) => ({ items: [...s.items, ...newItems] }))
  },

  enqueueSongStanza: (songId, stanzaId) => {
    const song = useSongStore.getState().getSong(songId)
    if (!song) return
    const stanza =
      stanzaId === song.chorus?.id
        ? song.chorus
        : song.stanzas.find((s) => s.id === stanzaId)
    if (!stanza) return
    const idx = stanza.kind === "verse" ? stanzaIndexById(song, stanzaId) : 0
    // Find first expanded chunk for this stanza to grab its pre-rendered text.
    const expanded = expandSong(song)
    const expandedIndex = expanded.findIndex((e) => e.stanzaRefId === stanzaId)
    if (expandedIndex < 0) return
    const item: QueueItem = {
      kind: "song-stanza",
      id: newQueueId(),
      source: "manual",
      added_at: Date.now(),
      songId: song.id,
      stanzaId,
      expandedIndex,
      reference: songMeta(song, stanza, idx),
      text: expanded[expandedIndex].text,
    }
    set((s) => ({ items: [...s.items, item] }))
  },

  jumpLiveSong: (songId) => {
    const startLen = get().items.length
    get().enqueueSong(songId)
    const after = get().items.length
    if (after > startLen) set({ activeIndex: startLen })
  },

  jumpToSongNumber: (num) => {
    const song = useSongStore
      .getState()
      .songs.find((s) => s.source === "ghs" && s.number === num)
    if (!song) return
    get().presentSongLive(song.id)
  },

  presentSongLive: (songId) => {
    const startLen = get().items.length
    get().enqueueSong(songId)
    const after = get().items.length
    if (after === startLen) return
    set({ activeIndex: startLen })

    // Render first stanza straight to live output.
    const firstItem = get().items[startLen]
    if (!firstItem || firstItem.kind !== "song-stanza") return
    void (async () => {
      const [{ useBroadcastStore }, { songStanzaToRenderData }] = await Promise.all([
        import("./broadcast-store"),
        import("@/lib/song-to-render"),
      ])
      const song = useSongStore.getState().getSong(firstItem.songId)
      const render = songStanzaToRenderData(firstItem, song)
      if (render) {
        useBroadcastStore.getState().setPreviewVerse(render)
        useBroadcastStore.getState().goLive()
      }
    })()
  },
}))

// Reactive: when a song is deleted from song-store, strip queue items
// referencing it AND keep activeIndex pointing at the same item by id (items
// before it shift left, so numeric index needs re-lookup).
useSongStore.subscribe((state, prevState) => {
  if (state.songs.length >= prevState.songs.length) return
  const liveIds = new Set(state.songs.map((s) => s.id))
  const q = useQueueStore.getState()
  const filtered = q.items.filter(
    (i) => i.kind !== "song-stanza" || liveIds.has(i.songId),
  )
  if (filtered.length === q.items.length) return

  // Preserve active cursor: find the previously-active item in the new list
  // by id. If it was itself removed, set active to null (live output will
  // clear on next render cycle).
  let newActive: number | null = null
  if (q.activeIndex !== null) {
    const prevActiveItem = q.items[q.activeIndex]
    if (prevActiveItem) {
      const idx = filtered.findIndex((i) => i.id === prevActiveItem.id)
      newActive = idx >= 0 ? idx : null
    }
  }
  useQueueStore.setState({ items: filtered, activeIndex: newActive })
})
