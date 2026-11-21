import {
  parseBroadcastTheme,
  constrainThemeLayout,
} from "@/lib/broadcast-theme"
import { useServicePlanStore } from "./service-plan-store"
import { create } from "zustand"
import { emit } from "@tauri-apps/api/event"
import { invoke } from "@tauri-apps/api/core"
import type {
  ImageSlide,
  BroadcastTheme,
  VerseRenderData,
  NotesSlide,
  TextHighlight,
} from "@/types"
import { BUILTIN_THEMES } from "@/lib/builtin-themes"
import { useSessionStore } from "@/stores/session-store"
import { useBibleStore } from "@/stores/bible-store"
import { useSettingsStore } from "@/stores/settings-store"
import { resolveBlankBackground } from "@/lib/brand"
import { validHighlights } from "@/lib/text-highlights"
import { BACKGROUND_MEDIA, backgroundContext, loadBackgroundChoices, saveBackgroundChoices, withLiveBackground, type BackgroundChoices, type BackgroundContext } from "@/lib/live-backgrounds"

type SelectedElement = "verse" | "reference" | null

interface BroadcastState {
  themes: BroadcastTheme[]
  activeThemeId: string
  altActiveThemeId: string
  backgrounds: BackgroundChoices
  setBackground: (context: BackgroundContext, id: string | null) => void
  setBackgroundDimming: (context: BackgroundContext, dimming: number) => void
  outputHidden: boolean
  isLive: boolean
  previewVerse: VerseRenderData | null
  liveVerse: VerseRenderData | null
  blankLogo: boolean
  setBlankLogo: (active: boolean) => void
  fullscreenImage: ImageSlide | null
  setFullscreenImage: (img: ImageSlide | null) => void
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
  saveTheme: (theme: BroadcastTheme) => Promise<void>
  deleteTheme: (id: string) => Promise<void>
  duplicateTheme: (id: string) => void
  setActiveTheme: (id: string) => void
  setAltActiveTheme: (id: string) => void
  setLive: (live: boolean) => void
  setPreviewVerse: (verse: VerseRenderData | null) => void
  setLiveVerse: (verse: VerseRenderData | null) => void
  updateLiveVerseHighlights: (highlights: TextHighlight[]) => void
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
  themeSaveStatus: "idle" | "saving"
  draftPast: BroadcastTheme[]
  draftFuture: BroadcastTheme[]
  undoDraft: () => void
  redoDraft: () => void
  updateDraftAsset: (themeId: string, path: string, url: string) => void
  saveDraft: () => Promise<BroadcastTheme | null>
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
  sendAnnouncement: (announcement: {
    text: string
    mode: "ticker" | "slide"
    duration: number | null
  }) => void
  pauseAnnouncement: () => void
  resumeAnnouncement: () => void
  dismissAnnouncement: () => void
}

type Nested = Record<string, unknown> | unknown[]

function sameVerseIdentity(
  a: {
    id: number
    translation_id: number
    book_number: number
    chapter: number
    verse: number
  },
  b: {
    id: number
    translation_id: number
    book_number: number
    chapter: number
    verse: number
  }
): boolean {
  return (
    a.book_number === b.book_number &&
    a.chapter === b.chapter &&
    a.verse === b.verse
  )
}

/** Immutably set a dot-path value, cloning each container along the way.
 *  Numeric path segments index into arrays (e.g. `"items.0.label"`). */
function setNestedValue<T extends Nested>(
  obj: T,
  path: string,
  value: unknown
): T {
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
      const child = (
        current as Record<string | number, unknown> | null | undefined
      )?.[property]
      target[property] = setAt(child, index + 1)
    }
    return next
  }

  return setAt(obj, 0) as T
}

function releasePlanOutput() {
  useServicePlanStore.getState().cancelPendingAdvance()
  useServicePlanStore.setState({ presentedItemId: null })
}

export const useBroadcastStore = create<BroadcastState>((set, get) => ({
  themes: [...BUILTIN_THEMES],
  activeThemeId: BUILTIN_THEMES[0].id,
  altActiveThemeId: BUILTIN_THEMES[0].id,
  backgrounds: loadBackgroundChoices(),
  setBackground: (context, id) => {
    if (id !== null && !BACKGROUND_MEDIA.some((media) => media.id === id)) return
    const backgrounds = {
      ...get().backgrounds,
      [context]: { ...get().backgrounds[context], id },
    }
    set({ backgrounds })
    saveBackgroundChoices(backgrounds)
    get().syncBroadcastOutput()
  },
  setBackgroundDimming: (context, dimming) => {
    if (!Number.isFinite(dimming)) return
    const backgrounds = {
      ...get().backgrounds,
      [context]: {
        ...get().backgrounds[context],
        dimming: Math.max(0, Math.min(0.8, dimming)),
      },
    }
    set({ backgrounds })
    saveBackgroundChoices(backgrounds)
    get().syncBroadcastOutput()
  },
  outputHidden: false,
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
    releasePlanOutput()
    set({
      blankLogo: active,
      outputHidden: false,
      fullscreenImage: active ? null : get().fullscreenImage,
      liveVerse: active ? null : get().liveVerse,
      liveNotes: active ? null : get().liveNotes,
      isLive: active ? true : get().isLive,
    })
    get().syncBroadcastOutput()
  },
  projectorMonitorIndex: null,
  setProjectorMonitorIndex: (projectorMonitorIndex) =>
    set({ projectorMonitorIndex }),
  fullscreenImage: null,
  setFullscreenImage: (fullscreenImage) => {
    releasePlanOutput()
    set({
      fullscreenImage,
      outputHidden: false,
      blankLogo: fullscreenImage ? false : get().blankLogo,
      liveVerse: fullscreenImage ? null : get().liveVerse,
      liveNotes: fullscreenImage ? null : get().liveNotes,
      isLive: fullscreenImage ? true : get().isLive,
    })
    get().syncBroadcastOutput()
  },
  liveNotes: null,
  setLiveNotes: (liveNotes) => {
    releasePlanOutput()
    set({
      liveNotes,
      outputHidden: false,
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
  saveTheme: async (theme) => {
    const valid = parseBroadcastTheme(theme)
    await invoke("save_custom_theme", {
      id: valid.id,
      name: valid.name,
      themeJson: JSON.stringify(valid),
    })
    set((s) => ({
      themes: s.themes.some((t) => t.id === valid.id)
        ? s.themes.map((t) => (t.id === valid.id ? valid : t))
        : [...s.themes, valid],
    }))
    if (get().activeThemeId === valid.id) get().syncBroadcastOutputFor("main")
    if (get().altActiveThemeId === valid.id) get().syncBroadcastOutputFor("alt")
  },
  deleteTheme: async (id) => {
    const theme = get().themes.find((t) => t.id === id)
    if (!theme || theme.builtin) return
    await invoke("delete_custom_theme", { id })
    set((s) => ({ themes: s.themes.filter((t) => t.id !== id) }))
    if (get().activeThemeId === id) get().setActiveTheme(BUILTIN_THEMES[0].id)
    if (get().altActiveThemeId === id)
      get().setAltActiveTheme(BUILTIN_THEMES[0].id)
    if (get().editingThemeId === id) get().startEditing(get().activeThemeId)
  },
  duplicateTheme: (id) => {
    if (get().themeSaveStatus === "saving") return
    const source = get().themes.find((t) => t.id === id)
    if (!source) return
    const draftTheme = {
      ...structuredClone(source),
      id: crypto.randomUUID(),
      name: `${source.name.slice(0, 115)} Copy`,
      builtin: false,
      pinned: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    set({
      editingThemeId: draftTheme.id,
      draftTheme,
      selectedElement: "verse",
      draftPast: [],
      draftFuture: [],
    })
  },
  syncBroadcastOutputFor: (outputId: string) => {
    const s = get()
    const themeId = outputId === "alt" ? s.altActiveThemeId : s.activeThemeId
    const theme = s.themes.find((t) => t.id === themeId) ?? s.themes[0]
    if (!theme) return

    // Use plain `emit` instead of `emitTo(label, ...)` — Tauri v2 has known
    // reliability issues with label-targeted emits (tauri-apps/tauri#11379).
    // Broadcast windows filter by outputId in the payload instead.
    const blank = resolveBlankBackground(useSettingsStore.getState().brand)

    void emit(`broadcast:verse-update:${outputId}`, {
      sentAt: Date.now(),
      theme: s.blankLogo || s.fullscreenImage || s.liveNotes
        ? theme
        : withLiveBackground(theme, s.backgrounds[backgroundContext(s.liveVerse)]),
      hidden: s.outputHidden,
      verse: s.liveVerse,
      blankLogo: s.blankLogo,
      blankLogoUrl: blank.imageUrl,
      blankVideoUrl: blank.videoUrl,
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
  setLive: (isLive) => {
    if (!isLive) releasePlanOutput()
    set({ isLive, outputHidden: !isLive })
    get().syncBroadcastOutput()
  },
  setPreviewVerse: (previewVerse) => {
    set({ previewVerse })
    if (!previewVerse) return
    const state = get()
    for (const output of ["main", "alt"]) {
      const id = output === "alt" ? state.altActiveThemeId : state.activeThemeId
      const theme =
        state.themes.find((theme) => theme.id === id) ?? state.themes[0]
      if (theme)
        void emit(`broadcast:preload:${output}`, { theme }).catch((error) =>
          console.warn("[broadcast-store] preload failed", error)
        )
    }
  },
  setLiveVerse: (liveVerse) => {
    releasePlanOutput()
    set({
      liveVerse,
      outputHidden: false,
      isLive: liveVerse !== null,
      blankLogo: false,
      fullscreenImage: null,
      liveNotes: null,
    })
    if (liveVerse) {
      get().addToHistory(liveVerse)

      // Mirror the live verse into the queue for quick re-reference. Source
      // the full Verse from the bible store's selectedVerse — every verse
      // pathway into setLiveVerse already calls `bibleActions.selectVerse()`
      // first, so it's reliably populated. Dedupe by scripture location.
      const sel = useBibleStore.getState().selectedVerse
      if (sel) {
        const bareRef = `${sel.book_name} ${sel.chapter}:${sel.verse}`
        const isChunkedLiveRef = /\(\d+\/\d+\)/.test(liveVerse.reference)
        if (!isChunkedLiveRef && liveVerse.reference.startsWith(bareRef)) {
          void import("@/stores/queue-store").then(({ useQueueStore }) => {
            const q = useQueueStore.getState()
            const exists = q.items.some(
              (it) => it.kind === "verse" && sameVerseIdentity(it.verse, sel)
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
        }).catch((e) =>
          console.warn("[broadcast-store] record_presented_verse failed:", e)
        )
      }
    }
    get().syncBroadcastOutput()
  },
  updateLiveVerseHighlights: (highlights) => {
    const current = get().liveVerse
    const text = current?.segments[0]?.text
    if (!current || !text) return
    const valid = validHighlights(text, highlights)
    const liveVerse = {
      ...current,
      highlights: valid.length > 0 ? valid : undefined,
    }
    set((state) => {
      const history = [...state.history]
      for (let index = history.length - 1; index >= 0; index -= 1) {
        if (history[index].verse.reference !== current.reference) continue
        history[index] = { ...history[index], verse: liveVerse }
        break
      }
      return { liveVerse, history }
    })
    get().syncBroadcastOutput()
  },
  addToHistory: (verse) => {
    const { history } = get()
    if (history[0]?.verse.reference === verse.reference) return
    set({
      history: [{ verse, presentedAt: Date.now() }, ...history].slice(0, 50),
    })
  },
  goLive: () => {
    const { projectorMonitorIndex } = get()
    // If projector window is already mounted (e.g. from session start), leave
    // it alone — re-opening kills the existing window.
    void invoke("is_broadcast_open", { outputId: "main" })
      .then((isOpen) => {
        if (isOpen) return
        const idx = projectorMonitorIndex ?? 0
        return invoke("open_broadcast_window", {
          outputId: "main",
          monitorIndex: idx,
        })
      })
      .catch((err) => console.warn("[broadcast-store]", err))

    const { previewVerse } = get()
    if (previewVerse) {
      get().setLiveVerse(previewVerse)
      set({ previewVerse: null })
    }
  },
  clearScreen: () => {
    releasePlanOutput()
    set({
      liveVerse: null,
      isLive: false,
      outputHidden: true,
      blankLogo: false,
      fullscreenImage: null,
      liveNotes: null,
    })
    get().syncBroadcastOutput()
    invoke("close_broadcast_window", { outputId: "main" }).catch((err) =>
      console.warn("[broadcast-store]", err)
    )
  },
  showProjector: () => {
    set({ outputHidden: false, isLive: true })
    const idx = get().projectorMonitorIndex ?? 0
    // If projector is reopening after a Kill (nothing live), default to the
    // blank EWC-logo screen so the audience sees branding, not a black void.
    const s = get()
    const hasContent =
      s.liveVerse !== null || s.fullscreenImage !== null || s.blankLogo
    if (!hasContent) {
      set({ blankLogo: true, isLive: true })
    }
    void invoke("is_broadcast_open", { outputId: "main" })
      .then((isOpen) => {
        if (isOpen) {
          get().syncBroadcastOutput()
          return
        }
        return invoke("open_broadcast_window", {
          outputId: "main",
          monitorIndex: idx,
        }).then(() => {
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
  themeSaveStatus: "idle",
  draftPast: [],
  draftFuture: [],
  setDesignerOpen: (isDesignerOpen) => {
    if (!isDesignerOpen) {
      if (get().themeSaveStatus === "saving") return
      set({
        isDesignerOpen,
        editingThemeId: null,
        draftTheme: null,
        selectedElement: null,
        draftPast: [],
        draftFuture: [],
      })
    } else {
      set({ isDesignerOpen })
      if (!get().draftTheme) get().startEditing(get().activeThemeId)
    }
  },
  startEditing: (themeId) => {
    if (get().themeSaveStatus === "saving") return
    const theme = get().themes.find((t) => t.id === themeId)
    if (!theme) return
    set({
      editingThemeId: themeId,
      draftTheme: structuredClone(theme),
      selectedElement: "verse",
      draftPast: [],
      draftFuture: [],
    })
  },
  updateDraft: (updates) =>
    set((s) => {
      if (!s.draftTheme || s.themeSaveStatus === "saving") return {}
      return {
        draftTheme: constrainThemeLayout({
          ...s.draftTheme,
          ...updates,
          updatedAt: Date.now(),
        }),
        draftPast: [...s.draftPast, s.draftTheme].slice(-50),
        draftFuture: [],
      }
    }),
  updateDraftNested: (path, value) => {
    const draft = get().draftTheme
    if (!draft) return
    const next = setNestedValue(
      draft as unknown as Record<string, unknown>,
      path,
      value
    ) as unknown as BroadcastTheme
    get().updateDraft(next)
  },
  updateDraftAsset: (themeId, path, url) => {
    if (get().draftTheme?.id !== themeId) return
    if (path === "background.image.url" && !get().draftTheme?.background.image)
      return
    if (path === "logo.url" && !get().draftTheme?.logo) return
    get().updateDraftNested(path, url)
  },
  undoDraft: () =>
    set((s) => {
      const previous = s.draftPast.at(-1)
      return !previous || !s.draftTheme || s.themeSaveStatus === "saving"
        ? {}
        : {
            draftTheme: previous,
            draftPast: s.draftPast.slice(0, -1),
            draftFuture: [...s.draftFuture, s.draftTheme],
          }
    }),
  redoDraft: () =>
    set((s) => {
      const next = s.draftFuture.at(-1)
      return !next || !s.draftTheme || s.themeSaveStatus === "saving"
        ? {}
        : {
            draftTheme: next,
            draftPast: [...s.draftPast, s.draftTheme],
            draftFuture: s.draftFuture.slice(0, -1),
          }
    }),
  saveDraft: async () => {
    const { draftTheme, themeSaveStatus } = get()
    if (!draftTheme || themeSaveStatus === "saving") return null
    const saved = parseBroadcastTheme(
      draftTheme.builtin
        ? {
            ...draftTheme,
            id: crypto.randomUUID(),
            name: `${draftTheme.name} (Custom)`,
            builtin: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }
        : draftTheme
    )
    set({ themeSaveStatus: "saving" })
    try {
      await get().saveTheme(saved)
      if (get().draftTheme?.id === draftTheme.id)
        set({
          editingThemeId: saved.id,
          draftTheme: saved,
          draftPast: [],
          draftFuture: [],
        })
      return saved
    } finally {
      set({ themeSaveStatus: "idle" })
    }
  },
  discardDraft: () => {
    const id = get().editingThemeId
    if (id && get().themes.some((t) => t.id === id)) get().startEditing(id)
    else get().startEditing(get().activeThemeId)
  },
  setSelectedElement: (selectedElement) => set({ selectedElement }),

  // Announcements
  announcement: null,
  sendAnnouncement: (announcement) => {
    const expiresAt = announcement.duration
      ? Date.now() + announcement.duration * 1000
      : null
    const full = {
      ...announcement,
      expiresAt,
      remainingMs: null,
      paused: false,
    }
    set({ announcement: full })
    invoke("ensure_broadcast_window", { outputId: "main" }).catch((err) =>
      console.warn("[broadcast-store]", err)
    )
    void emit("broadcast:announcement:main", announcement).catch((err) =>
      console.warn("[broadcast-store]", err)
    )
    void emit("broadcast:announcement:alt", announcement).catch((err) =>
      console.warn("[broadcast-store]", err)
    )
    scheduleAnnouncementExpiry(get)
  },
  pauseAnnouncement: () => {
    const a = get().announcement
    if (!a || a.paused || a.expiresAt == null) return
    const remainingMs = Math.max(0, a.expiresAt - Date.now())
    set({ announcement: { ...a, paused: true, remainingMs, expiresAt: null } })
    clearAnnouncementTimer()
    // Tell broadcast output to freeze the ticker scroll.
    void emit("broadcast:announcement:main", {
      ...a,
      paused: true,
      remainingMs,
      expiresAt: null,
    }).catch(() => {})
    void emit("broadcast:announcement:alt", {
      ...a,
      paused: true,
      remainingMs,
      expiresAt: null,
    }).catch(() => {})
  },
  resumeAnnouncement: () => {
    const a = get().announcement
    if (!a || !a.paused) return
    const remainingMs = a.remainingMs ?? 0
    const expiresAt = remainingMs > 0 ? Date.now() + remainingMs : null
    set({ announcement: { ...a, paused: false, expiresAt, remainingMs: null } })
    void emit("broadcast:announcement:main", {
      ...a,
      paused: false,
      expiresAt,
      remainingMs: null,
    }).catch(() => {})
    void emit("broadcast:announcement:alt", {
      ...a,
      paused: false,
      expiresAt,
      remainingMs: null,
    }).catch(() => {})
    scheduleAnnouncementExpiry(get)
  },
  dismissAnnouncement: () => {
    clearAnnouncementTimer()
    set({ announcement: null })
    void emit("broadcast:announcement:main", null).catch((err) =>
      console.warn("[broadcast-store]", err)
    )
    void emit("broadcast:announcement:alt", null).catch((err) =>
      console.warn("[broadcast-store]", err)
    )
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

function scheduleAnnouncementExpiry(get: () => BroadcastState) {
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
    const rows =
      await invoke<Array<[string, string, string]>>("list_custom_themes")
    const loaded = new Map<string, BroadcastTheme>()
    for (const [id, name, json] of rows) {
      try {
        loaded.set(id, parseBroadcastTheme({ ...JSON.parse(json), id, name }))
      } catch {
        console.warn("[themes] Skipping damaged theme", id)
      }
    }
    useBroadcastStore.setState((s) => ({
      themes: [
        ...s.themes
          .filter((t) => t.builtin)
          .map((t) => ({ ...t, pinned: loaded.get(t.id)?.pinned ?? t.pinned })),
        ...s.themes.filter((t) => !t.builtin),
        ...[...loaded.values()]
          .filter(
            (t) =>
              !BUILTIN_THEMES.some((b) => b.id === t.id) &&
              !s.themes.some((existing) => existing.id === t.id)
          )
          .map((t) => ({ ...t, builtin: false })),
      ],
    }))
  } catch {
    console.warn("[themes] Failed to load custom themes")
  }
}
