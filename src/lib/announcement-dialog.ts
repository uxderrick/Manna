import { create } from "zustand"

interface AnnouncementDialogState {
  isOpen: boolean
  openAnnouncement: () => void
  closeAnnouncement: () => void
}

export const useAnnouncementDialogStore = create<AnnouncementDialogState>((set) => ({
  isOpen: false,
  openAnnouncement: () => set({ isOpen: true }),
  closeAnnouncement: () => set({ isOpen: false }),
}))
