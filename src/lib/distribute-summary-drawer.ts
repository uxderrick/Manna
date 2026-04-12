import { create } from "zustand"

interface DistributeSummaryDrawerState {
  isOpen: boolean
  sessionId: number | null
  openDistributeSummary: (sessionId: number) => void
  closeDistributeSummary: () => void
}

export const useDistributeSummaryDrawerStore = create<DistributeSummaryDrawerState>((set) => ({
  isOpen: false,
  sessionId: null,
  openDistributeSummary: (sessionId) => set({ isOpen: true, sessionId }),
  closeDistributeSummary: () => set({ isOpen: false, sessionId: null }),
}))
