import { create } from "zustand"
import { emit } from "@tauri-apps/api/event"
import { invoke } from "@tauri-apps/api/core"
import type { BroadcastTheme, VerseRenderData } from "@/types"
import { BUILTIN_THEMES } from "@/lib/builtin-themes"

type SelectedElement = "verse" | "reference" | null

interface BroadcastState {
  themes: BroadcastTheme[]
  activeThemeId: string
  altActiveThemeId: string
  isLive: boolean
  previewVerse: VerseRenderData | null
  liveVerse: VerseRenderData | null
  history: Array<{ verse: VerseRenderData; presentedAt: number }>

  // Designer state
  isDesignerOpen: boolean
  editingThemeId: string | null
  draftTheme: BroadcastTheme | null
  selectedElement: SelectedElement

  // Theme management
  loadThemes: () => void
  saveTheme: (theme: BroadcastTheme) => void
  deleteTheme: (id: string) => void
  duplicateTheme: (id: string) => void
  setActiveTheme: (id: string) => void
  setAltActiveTheme: (id: string) => void
  setLive: (live: boolean) => void
  setPreviewVerse: (verse: VerseRenderData | null) => void
  setLiveVerse: (verse: VerseRenderData | null) => void
  addToHistory: (verse: VerseRenderData) => void
  goLive: () => void
  clearScreen: () => void
  syncBroadcastOutput: () => void
  syncBroadcastOutputFor: (outputId: string) => void

  // Designer actions
  setDesignerOpen: (open: boolean) => void
  startEditing: (themeId: string) => void
  updateDraft: (updates: Partial<BroadcastTheme>) => void
  updateDraftNested: (path: string, value: unknown) => void
  saveDraft: () => void
  discardDraft: () => void
  setSelectedElement: (el: SelectedElement) => void

  // Announcements
  announcement: {
    text: string
    position: "top" | "bottom"
    style: "info" | "urgent"
    duration: number | null
  } | null
  sendAnnouncement: (announcement: { text: string; position: "top" | "bottom"; style: "info" | "urgent"; duration: number | null }) => void
  dismissAnnouncement: () => void
}

type Nested = Record<string, unknown> | unknown[]

/** Immutably set a dot-path value, cloning each container along the way.
 *  Numeric path segments index into arrays (e.g. `"items.0.label"`). */
function setNestedValue<T extends Nested>(obj: T, path: string, value: unknown): T {
  const [head, ...rest] = path.split(".")
  const isIndex = /^\d+$/.test(head)
  const key = (isIndex ? Number(head) : head) as keyof Nested
  const next: Nested = Array.isArray(obj) ? [...obj] : { ...obj }

  if (rest.length === 0) {
    (next as Record<string | number, unknown>)[key as string | number] = value
  } else {
    const child = (obj as Record<string | number, unknown>)[key as string | number]
    const childContainer: Nested =
      child && typeof child === "object" ? (child as Nested) : /^\d+$/.test(rest[0]) ? [] : {}
    (next as Record<string | number, unknown>)[key as string | number] =
      setNestedValue(childContainer, rest.join("."), value)
  }

  return next as T
}

export const useBroadcastStore = create<BroadcastState>((set, get) => ({
  themes: [...BUILTIN_THEMES],
  activeThemeId: BUILTIN_THEMES[0].id,
  altActiveThemeId: BUILTIN_THEMES[0].id,
  isLive: false,
  previewVerse: null,
  liveVerse: null,
  history: [],
  isDesignerOpen: false,
  editingThemeId: null,
  draftTheme: null,
  selectedElement: null,

  loadThemes: () => {
    set({ themes: [...BUILTIN_THEMES] })
  },
  saveTheme: (theme) => {
    set((s) => ({
      themes: s.themes.some((t) => t.id === theme.id)
        ? s.themes.map((t) => (t.id === theme.id ? theme : t))
        : [...s.themes, theme],
    }))
    if (!theme.builtin) {
      invoke("save_custom_theme", {
        id: theme.id,
        name: theme.name,
        themeJson: JSON.stringify(theme),
      }).catch(() => {})
    }
  },
  deleteTheme: (id) => {
    set((s) => ({ themes: s.themes.filter((t) => t.id !== id || t.builtin) }))
    invoke("delete_custom_theme", { id }).catch(() => {})
  },
  duplicateTheme: (id) => {
    const s = get()
    const source = s.themes.find((t) => t.id === id)
    if (!source) return
    const newTheme: BroadcastTheme = {
      ...source,
      id: crypto.randomUUID(),
      name: `${source.name} Copy`,
      builtin: false,
      pinned: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    set((s) => ({ themes: [...s.themes, newTheme] }))
  },
  syncBroadcastOutputFor: (outputId: string) => {
    const s = get()
    const themeId = outputId === "alt" ? s.altActiveThemeId : s.activeThemeId
    const theme = s.themes.find((t) => t.id === themeId) ?? s.themes[0]
    if (!theme) return

    // Use plain `emit` instead of `emitTo(label, ...)` — Tauri v2 has known
    // reliability issues with label-targeted emits (tauri-apps/tauri#11379).
    // Broadcast windows filter by outputId in the payload instead.
    void emit(`broadcast:verse-update:${outputId}`, {
      theme,
      verse: s.liveVerse,
    }).catch(() => {})
  },
  syncBroadcastOutput: () => {
    get().syncBroadcastOutputFor("main")
    get().syncBroadcastOutputFor("alt")
  },
  setActiveTheme: (activeThemeId) => {
    set({ activeThemeId })
    get().syncBroadcastOutputFor("main")
  },
  setAltActiveTheme: (altActiveThemeId) => {
    set({ altActiveThemeId })
    get().syncBroadcastOutputFor("alt")
  },
  setLive: (isLive) => set({ isLive }),
  setPreviewVerse: (previewVerse) => set({ previewVerse }),
  setLiveVerse: (liveVerse) => {
    set({ liveVerse, isLive: liveVerse !== null })
    if (liveVerse) get().addToHistory(liveVerse)
    get().syncBroadcastOutput()
  },
  addToHistory: (verse) => {
    const { history } = get()
    if (history[0]?.verse.reference === verse.reference) return
    set({ history: [{ verse, presentedAt: Date.now() }, ...history].slice(0, 50) })
  },
  goLive: () => {
    // Always ensure broadcast window is open
    invoke("ensure_broadcast_window", { outputId: "main" }).catch(() => {})
    invoke("list_monitors").then((monitors) => {
      const monitorList = monitors as Array<{ name: string; width: number; height: number }>
      const targetIdx = monitorList.length > 1 ? 1 : 0
      invoke("open_broadcast_window", { outputId: "main", monitorIndex: targetIdx }).catch(() => {})
    }).catch(() => {})

    const { previewVerse } = get()
    if (previewVerse) {
      get().setLiveVerse(previewVerse)
      set({ previewVerse: null })
    }
  },
  clearScreen: () => {
    get().setLiveVerse(null)
    set({ isLive: false })
    invoke("close_broadcast_window", { outputId: "main" }).catch(() => {})
  },

  // Designer
  setDesignerOpen: (isDesignerOpen) => {
    if (!isDesignerOpen) {
      set({ isDesignerOpen, editingThemeId: null, draftTheme: null, selectedElement: null })
    } else {
      set({ isDesignerOpen })
    }
  },
  startEditing: (themeId) => {
    const theme = get().themes.find((t) => t.id === themeId)
    if (!theme) return
    set({
      editingThemeId: themeId,
      draftTheme: { ...theme, updatedAt: Date.now() },
      selectedElement: null,
    })
  },
  updateDraft: (updates) =>
    set((s) => ({
      draftTheme: s.draftTheme ? { ...s.draftTheme, ...updates, updatedAt: Date.now() } : null,
    })),
  updateDraftNested: (path, value) =>
    set((s) => ({
      draftTheme: s.draftTheme
        ? { ...setNestedValue(s.draftTheme as unknown as Record<string, unknown>, path, value), updatedAt: Date.now() } as BroadcastTheme
        : null,
    })),
  saveDraft: () => {
    const { draftTheme } = get()
    if (!draftTheme) return
    // If editing a builtin, save as a new custom theme
    if (draftTheme.builtin) {
      const customTheme = {
        ...draftTheme,
        id: crypto.randomUUID(),
        name: `${draftTheme.name} (Custom)`,
        builtin: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      set((s) => ({
        themes: [...s.themes, customTheme],
        activeThemeId: customTheme.id,
        editingThemeId: customTheme.id,
        draftTheme: customTheme,
      }))
    } else {
      get().saveTheme(draftTheme)
    }
  },
  discardDraft: () => {
    const { editingThemeId } = get()
    if (editingThemeId) {
      get().startEditing(editingThemeId)
    }
  },
  setSelectedElement: (selectedElement) => set({ selectedElement }),

  // Announcements
  announcement: null,
  sendAnnouncement: (announcement) => {
    set({ announcement })
    invoke("ensure_broadcast_window", { outputId: "main" }).catch(() => {})
    void emit("broadcast:announcement:main", announcement).catch(() => {})
    void emit("broadcast:announcement:alt", announcement).catch(() => {})
    if (announcement.duration) {
      setTimeout(() => {
        const current = get().announcement
        if (current && current.text === announcement.text) {
          get().dismissAnnouncement()
        }
      }, announcement.duration * 1000)
    }
  },
  dismissAnnouncement: () => {
    set({ announcement: null })
    void emit("broadcast:announcement:main", null).catch(() => {})
    void emit("broadcast:announcement:alt", null).catch(() => {})
  },
}))

export async function hydrateCustomThemes(): Promise<void> {
  try {
    const rows = await invoke<Array<[string, string, string]>>("list_custom_themes")
    const customThemes: BroadcastTheme[] = rows.map(([_id, _name, json]) => {
      return JSON.parse(json) as BroadcastTheme
    })
    if (customThemes.length > 0) {
      const { themes } = useBroadcastStore.getState()
      const builtinIds = new Set(themes.filter(t => t.builtin).map(t => t.id))
      const merged = [
        ...themes.filter(t => t.builtin),
        ...customThemes.filter(t => !builtinIds.has(t.id)),
      ]
      useBroadcastStore.setState({ themes: merged })
    }
  } catch {
    console.warn("[themes] Failed to load custom themes")
  }
}
