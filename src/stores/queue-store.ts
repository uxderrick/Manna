import { create } from "zustand"
import type { QueueItem, Song, TextHighlight } from "@/types"
import { expandSong } from "@/lib/song-expand"
import { songMeta } from "@/lib/song-meta"
import { useSongStore } from "./song-store"
import { useSessionStore } from "./session-store"
import { useSettingsStore } from "@/stores/settings-store"
import { splitVerseIntoChunks, wordCount } from "@/lib/verse-splitter"
import { validHighlights } from "@/lib/text-highlights"

// localStorage key for the in-flight queue. Tagged with the active session id
// so a reload mid-service restores that session's queue, while a fresh session
// starts empty.
const QUEUE_STORAGE_KEY = "manna:queue"

interface PersistedQueue {
  sessionId: number | null
  items: QueueItem[]
  activeIndex: number | null
}

interface QueueState {
  items: QueueItem[]
  activeIndex: number | null

  addItem: (item: QueueItem) => QueueItem[]
  removeItem: (id: string) => void
  reorderItems: (fromIndex: number, toIndex: number) => void
  setActive: (index: number | null) => void
  clearQueue: () => void
  updateVerseHighlights: (id: string, highlights: TextHighlight[]) => void

  enqueueSong: (songId: string) => void
  enqueueSongStanza: (songId: string, stanzaId: string) => void
  jumpLiveSong: (songId: string) => void
  jumpToSongNumber: (num: number) => void
  presentSongLive: (songId: string) => void
  enqueueImage: (input: { url: string; label: string; thumbnailUrl?: string; provider: "pexels" | "unsplash" | "local" }) => void
  presentImageLive: (input: { url: string; label: string; thumbnailUrl?: string; provider: "pexels" | "unsplash" | "local" }) => void
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

  addItem: (item) => {
    let inserted: QueueItem[] = [item]
    set((state) => {
      // Only verses are eligible to split. Songs/images pass through untouched.
      if (item.kind !== "verse") {
        return { items: [...state.items, item] }
      }
      const settings = useSettingsStore.getState()
      if (!settings.autoSplitLongVerses) {
        return { items: [...state.items, item] }
      }
      if (wordCount(item.verse.text) <= settings.splitWordThreshold) {
        return { items: [...state.items, item] }
      }
      const chunks = splitVerseIntoChunks(item.verse.text)
      if (chunks.length <= 1) {
        return { items: [...state.items, item] }
      }
      const groupId = crypto.randomUUID()
      const expanded = chunks.map((text, i) => ({
        ...item,
        id: crypto.randomUUID(),
        reference: `${item.reference} (${i + 1}/${chunks.length})`,
        chunk: {
          groupId,
          index: i + 1,
          total: chunks.length,
          text,
        },
      }))
      inserted = expanded
      return { items: [...state.items, ...expanded] }
    })
    return inserted
  },
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
  updateVerseHighlights: (id, highlights) => set((state) => ({
    items: state.items.map((item) => {
      if (item.id !== id || item.kind !== "verse") return item
      const text = item.chunk?.text ?? item.verse.text
      return { ...item, highlights: validHighlights(text, highlights) }
    }),
  })),

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

  enqueueImage: ({ url, label, thumbnailUrl, provider }) => {
    const item: QueueItem = {
      kind: "image",
      id: `image-q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      source: "manual",
      added_at: Date.now(),
      url,
      label,
      thumbnailUrl,
      provider,
    }
    set((s) => ({ items: [...s.items, item] }))
  },

  presentImageLive: ({ url, label, thumbnailUrl, provider }) => {
    get().enqueueImage({ url, label, thumbnailUrl, provider })
    const idx = get().items.length - 1
    set({ activeIndex: idx })
    void import("./broadcast-store").then(({ useBroadcastStore }) => {
      useBroadcastStore.getState().setFullscreenImage({ url, label })
    })
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

// ── Persistence ────────────────────────────────────────────────────
// Survive an accidental reload mid-service. The queue is written to
// localStorage on every change (tagged with the active session id) and
// restored when that same session becomes active again.

/** Restore the persisted queue if it belongs to `sessionId`, else reset to
 *  empty (a fresh session must not inherit the previous session's queue). */
export function hydrateQueue(sessionId: number): void {
  let restored = false
  try {
    const raw = localStorage.getItem(QUEUE_STORAGE_KEY)
    if (raw) {
      const data = JSON.parse(raw) as PersistedQueue
      if (data.sessionId === sessionId && Array.isArray(data.items)) {
        useQueueStore.setState({
          items: data.items,
          activeIndex: typeof data.activeIndex === "number" ? data.activeIndex : null,
        })
        restored = true
      }
    }
  } catch (e) {
    console.warn("[queue] hydrate failed", e)
  }
  if (!restored) {
    useQueueStore.setState({ items: [], activeIndex: null })
  }
}

/** Drop the persisted queue (call on End Session). */
export function clearPersistedQueue(): void {
  try {
    localStorage.removeItem(QUEUE_STORAGE_KEY)
  } catch (e) {
    console.warn("[queue] clear persisted failed", e)
  }
}

// Write on every queue change, but only while a session is active — otherwise
// the empty post-reload init state would clobber a saved queue before the
// session is restored.
useQueueStore.subscribe((state) => {
  const sessionId = useSessionStore.getState().activeSession?.id ?? null
  if (sessionId === null) return
  try {
    const payload: PersistedQueue = {
      sessionId,
      items: state.items,
      activeIndex: state.activeIndex,
    }
    localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(payload))
  } catch (e) {
    console.warn("[queue] persist failed", e)
  }
})

// Restore the queue when a session becomes active (e.g. after a reload the
// ResumeSessionDialog re-sets activeSession). A fresh session resets to empty.
let lastTrackedSessionId: number | null = null
useSessionStore.subscribe((state) => {
  const id = state.activeSession?.id ?? null
  if (id === lastTrackedSessionId) return
  lastTrackedSessionId = id
  if (id !== null) hydrateQueue(id)
})

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
