import { create } from "zustand"
import { emit } from "@tauri-apps/api/event"
import { invoke } from "@tauri-apps/api/core"
import type { BroadcastTheme, VerseRenderData, NotesSlide } from "@/types"
import { BUILTIN_THEMES } from "@/lib/builtin-themes"
import { useSessionStore } from "@/stores/session-store"
import { useBibleStore } from "@/stores/bible-store"
import { useSettingsStore } from "@/stores/settings-store"
import { resolveBrandAsset } from "@/lib/brand"

type SelectedElement = "verse" | "reference" | null

interface BroadcastState {
  themes: BroadcastTheme[]
  activeThemeId: string
  altActiveThemeId: string
  isLive: boolean
  previewVerse: VerseRenderData | null
  liveVerse: VerseRenderData | null
  blankLogo: boolean
  setBlankLogo: (active: boolean) => void
  fullscreenImage: { url: string; label: string } | null
  setFullscreenImage: (img: { url: string; label: string } | null) => void
  liveNotes: NotesSlide | null
  setLiveNotes: (slide: NotesSlide | null) => void
  /** Monitor index where the operator chose to put the projector this session. */
  projectorMonitorIndex: number | null
  setProjectorMonitorIndex: (idx: number | null) => void
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
  showProjector: () => void

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
    mode: "ticker" | "slide"
    duration: number | null
    /** Wall-clock ms when announcement should auto-dismiss. `null` when paused or no duration. */
    expiresAt: number | null
    /** When paused: ms left until expiry at the moment of pause. Resume rebuilds expiresAt. */
    remainingMs: number | null
    paused: boolean
  } | null
  sendAnnouncement: (announcement: { text: string; mode: "ticker" | "slide"; duration: number | null }) => void
  pauseAnnouncement: () => void
  resumeAnnouncement: () => void
  dismissAnnouncement: () => void
}

type Nested = Record<string, unknown> | unknown[]

function sameVerseIdentity(
  a: { id: number; translation_id: number; book_number: number; chapter: number; verse: number },
  b: { id: number; translation_id: number; book_number: number; chapter: number; verse: number },
): boolean {
  if (a.id !== 0 && b.id !== 0) return a.id === b.id
  return (
    a.translation_id === b.translation_id &&
    a.book_number === b.book_number &&
    a.chapter === b.chapter &&
    a.verse === b.verse
  )
}

/** Immutably set a dot-path value, cloning each container along the way.
 *  Numeric path segments index into arrays (e.g. `"items.0.label"`). */
function setNestedValue<T extends Nested>(obj: T, path: string, value: unknown): T {
  const parts = path.split(".").filter(Boolean)
  if (parts.length === 0) return obj

  const setAt = (current: unknown, index: number): unknown => {
    const key = parts[index]
    const property = /^\d+$/.test(key) ? Number(key) : key
    const next = Array.isArray(current)
      ? [...current]
      : current && typeof current === "object"
        ? { ...(current as Record<string, unknown>) }
        : typeof property === "number"
          ? []
          : {}
    const target = next as Record<string | number, unknown>

    if (index === parts.length - 1) {
      target[property] = value
    } else {
      const child = (current as Record<string | number, unknown> | null | undefined)?.[property]
      target[property] = setAt(child, index + 1)
    }
    return next
  }

  return setAt(obj, 0) as T
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
  blankLogo: false,
  setBlankLogo: (active) => {
    set({
      blankLogo: active,
      fullscreenImage: active ? null : get().fullscreenImage,
      liveVerse: active ? null : get().liveVerse,
      liveNotes: active ? null : get().liveNotes,
      isLive: active ? true : get().isLive,
    })
    get().syncBroadcastOutput()
  },
  projectorMonitorIndex: null,
  setProjectorMonitorIndex: (projectorMonitorIndex) => set({ projectorMonitorIndex }),
  fullscreenImage: null,
  setFullscreenImage: (fullscreenImage) => {
    set({
      fullscreenImage,
      blankLogo: fullscreenImage ? false : get().blankLogo,
      liveVerse: fullscreenImage ? null : get().liveVerse,
      liveNotes: fullscreenImage ? null : get().liveNotes,
      isLive: fullscreenImage ? true : get().isLive,
    })
    get().syncBroadcastOutput()
  },
  liveNotes: null,
  setLiveNotes: (liveNotes) => {
    set({
      liveNotes,
      liveVerse: liveNotes ? null : get().liveVerse,
      fullscreenImage: liveNotes ? null : get().fullscreenImage,
      blankLogo: liveNotes ? false : get().blankLogo,
      isLive: liveNotes ? true : get().isLive,
    })
    get().syncBroadcastOutput()
  },

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
      }).catch((err) => console.warn("[broadcast-store]", err))
    }
  },
  deleteTheme: (id) => {
    set((s) => ({ themes: s.themes.filter((t) => t.id !== id || t.builtin) }))
    invoke("delete_custom_theme", { id }).catch((err) => console.warn("[broadcast-store]", err))
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
    set((s) => ({
      themes: [...s.themes, newTheme],
      editingThemeId: newTheme.id,
      draftTheme: newTheme,
      selectedElement: "verse",
    }))
  },
  syncBroadcastOutputFor: (outputId: string) => {
    const s = get()
    const themeId = outputId === "alt" ? s.altActiveThemeId : s.activeThemeId
    const theme = s.themes.find((t) => t.id === themeId) ?? s.themes[0]
    if (!theme) return

    // Use plain `emit` instead of `emitTo(label, ...)` — Tauri v2 has known
    // reliability issues with label-targeted emits (tauri-apps/tauri#11379).
    // Broadcast windows filter by outputId in the payload instead.
    const blankLogoUrl = resolveBrandAsset("blank", useSettingsStore.getState().brand.blankImagePath)

    void emit(`broadcast:verse-update:${outputId}`, {
      theme,
      verse: s.liveVerse,
      blankLogo: s.blankLogo,
      blankLogoUrl,
      fullscreenImage: s.fullscreenImage,
      notes: s.liveNotes,
    }).catch((err) => console.warn("[broadcast-store]", err))
  },
  syncBroadcastOutput: () => {
    // Push persisted projector calibration (editing=false) so a freshly-opened
    // window applies it without the Settings panel being open.
    void emit("projector:calibration", {
      insets: useSettingsStore.getState().projectorCalibration,
      editing: false,
    }).catch(() => {})
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
    set({
      liveVerse,
      isLive: liveVerse !== null,
      blankLogo: false,
      fullscreenImage: liveVerse ? null : get().fullscreenImage,
      liveNotes: liveVerse ? null : get().liveNotes,
    })
    if (liveVerse) {
      get().addToHistory(liveVerse)

      // Mirror the live verse into the queue for quick re-reference. Source
      // the full Verse from the bible store's selectedVerse — every verse
      // pathway into setLiveVerse already calls `bibleActions.selectVerse()`
      // first, so it's reliably populated. Dedupe by verse id.
      const sel = useBibleStore.getState().selectedVerse
      if (sel) {
        const bareRef = `${sel.book_name} ${sel.chapter}:${sel.verse}`
        const isChunkedLiveRef = /\(\d+\/\d+\)/.test(liveVerse.reference)
        if (!isChunkedLiveRef && liveVerse.reference.startsWith(bareRef)) {
          void import("@/stores/queue-store").then(({ useQueueStore }) => {
            const q = useQueueStore.getState()
            const exists = q.items.some(
              (it) =>
                it.kind === "verse" &&
                sameVerseIdentity(it.verse, sel),
            )
            if (exists) return
            q.addItem({
              kind: "verse",
              id: crypto.randomUUID(),
              verse: sel,
              reference: bareRef,
              confidence: 1,
              source: "manual",
              added_at: Date.now(),
              highlights: liveVerse.highlights,
            })
          })
        }
      }

      const session = useSessionStore.getState().activeSession
      // Record presentations during planned + live phases — operators often
      // preview verses on the projector before "Start Service", and those
      // should still count toward the session's presented history.
      if (session && session.status !== "completed") {
        // "Genesis 1:1 (KJV)" → ref="Genesis 1:1", translation="KJV"
        const m = liveVerse.reference.match(/^(.*?)\s*\(([^)]+)\)\s*$/)
        const verseRef = m ? m[1].trim() : liveVerse.reference
        const translation = m ? m[2].trim() : ""
        const verseText = liveVerse.segments.map((s) => s.text).join(" ")
        invoke("record_presented_verse", {
          sessionId: session.id,
          verseRef,
          verseText,
          translation,
        }).catch((e) => console.warn("[broadcast-store] record_presented_verse failed:", e))
      }
    }
    get().syncBroadcastOutput()
  },
  addToHistory: (verse) => {
    const { history } = get()
    if (history[0]?.verse.reference === verse.reference) return
    set({ history: [{ verse, presentedAt: Date.now() }, ...history].slice(0, 50) })
  },
  goLive: () => {
    const { projectorMonitorIndex } = get()
    // If projector window is already mounted (e.g. from session start), leave
    // it alone — re-opening kills the existing window.
    void invoke("is_broadcast_open", { outputId: "main" })
      .then((isOpen) => {
        if (isOpen) return
        const idx = projectorMonitorIndex ?? 0
        return invoke("open_broadcast_window", { outputId: "main", monitorIndex: idx })
      })
      .catch((err) => console.warn("[broadcast-store]", err))

    const { previewVerse } = get()
    if (previewVerse) {
      get().setLiveVerse(previewVerse)
      set({ previewVerse: null })
    }
  },
  clearScreen: () => {
    set({ liveVerse: null, isLive: false, blankLogo: false, fullscreenImage: null, liveNotes: null })
    get().syncBroadcastOutput()
    invoke("close_broadcast_window", { outputId: "main" }).catch((err) => console.warn("[broadcast-store]", err))
  },
  showProjector: () => {
    const idx = get().projectorMonitorIndex ?? 0
    // If projector is reopening after a Kill (nothing live), default to the
    // blank EWC-logo screen so the audience sees branding, not a black void.
    const s = get()
    const hasContent = s.liveVerse !== null || s.fullscreenImage !== null || s.blankLogo
    if (!hasContent) {
      set({ blankLogo: true, isLive: true })
    }
    void invoke("is_broadcast_open", { outputId: "main" })
      .then((isOpen) => {
        if (isOpen) {
          get().syncBroadcastOutput()
          return
        }
        return invoke("open_broadcast_window", { outputId: "main", monitorIndex: idx }).then(() => {
          // Fresh window: listener registers AFTER React mount. Emit on a
          // short burst so the verse-update event lands once the listener is
          // attached. Without this the projector opens black despite our
          // blank-logo state.
          const burst = [120, 300, 600, 1200, 2000]
          for (const delay of burst) {
            setTimeout(() => get().syncBroadcastOutput(), delay)
          }
        })
      })
      .catch((err) => console.warn("[broadcast-store]", err))
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
      get().saveTheme(customTheme)
      set((s) => ({
        themes: s.themes.some((theme) => theme.id === customTheme.id)
          ? s.themes
          : [...s.themes, customTheme],
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
    const expiresAt = announcement.duration ? Date.now() + announcement.duration * 1000 : null
    const full = {
      ...announcement,
      expiresAt,
      remainingMs: null,
      paused: false,
    }
    set({ announcement: full })
    invoke("ensure_broadcast_window", { outputId: "main" }).catch((err) => console.warn("[broadcast-store]", err))
    void emit("broadcast:announcement:main", announcement).catch((err) => console.warn("[broadcast-store]", err))
    void emit("broadcast:announcement:alt", announcement).catch((err) => console.warn("[broadcast-store]", err))
    scheduleAnnouncementExpiry(get, set)
  },
  pauseAnnouncement: () => {
    const a = get().announcement
    if (!a || a.paused || a.expiresAt == null) return
    const remainingMs = Math.max(0, a.expiresAt - Date.now())
    set({ announcement: { ...a, paused: true, remainingMs, expiresAt: null } })
    clearAnnouncementTimer()
    // Tell broadcast output to freeze the ticker scroll.
    void emit("broadcast:announcement:main", { ...a, paused: true, remainingMs, expiresAt: null }).catch(() => {})
    void emit("broadcast:announcement:alt", { ...a, paused: true, remainingMs, expiresAt: null }).catch(() => {})
  },
  resumeAnnouncement: () => {
    const a = get().announcement
    if (!a || !a.paused) return
    const remainingMs = a.remainingMs ?? 0
    const expiresAt = remainingMs > 0 ? Date.now() + remainingMs : null
    set({ announcement: { ...a, paused: false, expiresAt, remainingMs: null } })
    void emit("broadcast:announcement:main", { ...a, paused: false, expiresAt, remainingMs: null }).catch(() => {})
    void emit("broadcast:announcement:alt", { ...a, paused: false, expiresAt, remainingMs: null }).catch(() => {})
    scheduleAnnouncementExpiry(get, set)
  },
  dismissAnnouncement: () => {
    clearAnnouncementTimer()
    set({ announcement: null })
    void emit("broadcast:announcement:main", null).catch((err) => console.warn("[broadcast-store]", err))
    void emit("broadcast:announcement:alt", null).catch((err) => console.warn("[broadcast-store]", err))
  },
}))

// ── Announcement auto-expiry plumbing ──────────────────────────
// Keep the timer out of closure scope so pause/resume can manipulate it.
let announcementTimer: number | null = null

function clearAnnouncementTimer() {
  if (announcementTimer != null) {
    clearTimeout(announcementTimer)
    announcementTimer = null
  }
}

function scheduleAnnouncementExpiry(
  get: () => BroadcastState,
  _set: (partial: Partial<BroadcastState>) => void,
) {
  clearAnnouncementTimer()
  const a = get().announcement
  if (!a || a.expiresAt == null) return
  const ms = a.expiresAt - Date.now()
  if (ms <= 0) {
    get().dismissAnnouncement()
    return
  }
  announcementTimer = window.setTimeout(() => {
    announcementTimer = null
    const cur = get().announcement
    if (cur && cur.expiresAt != null && cur.expiresAt <= Date.now()) {
      get().dismissAnnouncement()
    }
  }, ms)
}

export async function hydrateCustomThemes(): Promise<void> {
  try {
    const rows = await invoke<Array<[string, string, string]>>("list_custom_themes")
    const customThemes: BroadcastTheme[] = []
    for (const [id, _name, json] of rows) {
      try {
        customThemes.push(JSON.parse(json) as BroadcastTheme)
      } catch (err) {
        console.warn("[themes] dropping corrupt row", id, err)
      }
    }
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
