import { create } from "zustand"

type PanelId = "left" | "center" | "right"

interface PanelTabsState {
  tabs: Record<PanelId, string>
  setTab: (panel: PanelId, tabId: string) => void
}

export const usePanelTabsStore = create<PanelTabsState>((set) => ({
  tabs: {
    left: "search",
    center: "detections",
    right: "queue",
  },
  setTab: (panel, tabId) =>
    set((state) => ({
      tabs: { ...state.tabs, [panel]: tabId },
    })),
}))

export type { PanelId }
