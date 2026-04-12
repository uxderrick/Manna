import { create } from "zustand"
import type { SermonSession } from "@/types/session"

interface SessionState {
  activeSession: SermonSession | null
  sessions: SermonSession[]
  isLoading: boolean
}

interface SessionActions {
  setActiveSession: (session: SermonSession | null) => void
  setSessions: (sessions: SermonSession[]) => void
  updateActiveSession: (updates: Partial<SermonSession>) => void
  setLoading: (loading: boolean) => void
}

export const useSessionStore = create<SessionState & SessionActions>((set) => ({
  activeSession: null,
  sessions: [],
  isLoading: false,
  setActiveSession: (session) => set({ activeSession: session }),
  setSessions: (sessions) => set({ sessions }),
  updateActiveSession: (updates) =>
    set((state) => ({
      activeSession: state.activeSession
        ? { ...state.activeSession, ...updates }
        : null,
    })),
  setLoading: (isLoading) => set({ isLoading }),
}))
