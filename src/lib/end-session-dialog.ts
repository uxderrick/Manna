import { create } from "zustand"

interface EndSessionDialogState {
  isOpen: boolean
  sessionId: number | null
  openEndSession: (sessionId: number) => void
  closeEndSession: () => void
}

export const useEndSessionDialogStore = create<EndSessionDialogState>((set) => ({
  isOpen: false,
  sessionId: null,
  openEndSession: (sessionId) => set({ isOpen: true, sessionId }),
  closeEndSession: () => set({ isOpen: false, sessionId: null }),
}))
