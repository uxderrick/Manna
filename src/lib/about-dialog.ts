import { create } from "zustand"

interface AboutDialogState {
  isOpen: boolean
  openAbout: () => void
  closeAbout: () => void
}

export const useAboutDialogStore = create<AboutDialogState>((set) => ({
  isOpen: false,
  openAbout: () => set({ isOpen: true }),
  closeAbout: () => set({ isOpen: false }),
}))
