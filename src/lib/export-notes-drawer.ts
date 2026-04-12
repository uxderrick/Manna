import { create } from "zustand"

interface ExportNotesDrawerState {
  isOpen: boolean
  sessionId: number | null
  openExportNotes: (sessionId: number) => void
  closeExportNotes: () => void
}

export const useExportNotesDrawerStore = create<ExportNotesDrawerState>((set) => ({
  isOpen: false,
  sessionId: null,
  openExportNotes: (sessionId) => set({ isOpen: true, sessionId }),
  closeExportNotes: () => set({ isOpen: false, sessionId: null }),
}))
