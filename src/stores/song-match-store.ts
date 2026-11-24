import { create } from "zustand"

/** One candidate from the backend's `song_matches` event. */
export interface SongMatchItem {
  songId: string
  /** 0 to 1 */
  score: number
  /** Lyrics only: stanza being sung (stanzas in order, chorus last). */
  stanza: number | null
  /** Lyrics only: the line most like what was heard. */
  line: string | null
}

export type SongMatchSource = "lyrics" | "sound"

export interface SongMatchesPayload {
  source: SongMatchSource
  matches: SongMatchItem[]
  confident: boolean
}

export interface SongModeStatus {
  enabled: boolean
  lyricsSongs: number
  sound: boolean
  soundNote: string | null
  soundSongs: number
}

/** A song as shown in the panel: both sources merged. */
export interface MergedSongMatch {
  songId: string
  score: number
  sources: SongMatchSource[]
  confident: boolean
  stanza: number | null
  line: string | null
  updatedAt: number
}

interface SourceState {
  matches: SongMatchItem[]
  confident: boolean
  updatedAt: number
}

export type DetectionMode = "verses" | "songs"

interface SongMatchState {
  mode: DetectionMode
  status: SongModeStatus | null
  bySource: Partial<Record<SongMatchSource, SourceState>>
  setMode: (mode: DetectionMode) => void
  setStatus: (status: SongModeStatus | null) => void
  receive: (payload: SongMatchesPayload, now?: number) => void
  clear: () => void
}

export const useSongMatchStore = create<SongMatchState>((set) => ({
  mode: "verses",
  status: null,
  bySource: {},
  setMode: (mode) => set({ mode }),
  setStatus: (status) => set({ status }),
  receive: (payload, now = Date.now()) =>
    set((state) => {
      // An empty result keeps the last matches on screen (singing has
      // pauses and unclear lines); only new matches replace them.
      if (payload.matches.length === 0) return state
      return {
        bySource: {
          ...state.bySource,
          [payload.source]: { matches: payload.matches, confident: payload.confident, updatedAt: now },
        },
      }
    }),
  clear: () => set({ bySource: {} }),
}))

/** Lyrics and sound results per song, confident and best first. */
export function mergeSongMatches(bySource: SongMatchState["bySource"]): MergedSongMatch[] {
  const merged = new Map<string, MergedSongMatch>()
  for (const source of ["lyrics", "sound"] as const) {
    const state = bySource[source]
    if (!state) continue
    state.matches.forEach((m, i) => {
      const confident = state.confident && i === 0
      const prev = merged.get(m.songId)
      if (!prev) {
        merged.set(m.songId, {
          songId: m.songId,
          score: m.score,
          sources: [source],
          confident,
          stanza: m.stanza,
          line: m.line,
          updatedAt: state.updatedAt,
        })
        return
      }
      prev.sources.push(source)
      prev.score = Math.max(prev.score, m.score)
      prev.confident ||= confident
      prev.stanza ??= m.stanza
      prev.line ??= m.line
      prev.updatedAt = Math.max(prev.updatedAt, state.updatedAt)
    })
  }
  return [...merged.values()].sort(
    (a, b) =>
      Number(b.confident) - Number(a.confident) ||
      b.sources.length - a.sources.length ||
      b.updatedAt - a.updatedAt ||
      b.score - a.score,
  )
}
