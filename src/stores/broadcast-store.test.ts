import { beforeEach, describe, expect, it, vi } from "vitest"

const emitMock = vi.fn()
const invokeMock = vi.fn()

vi.mock("@tauri-apps/api/event", () => ({
  emit: emitMock,
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  convertFileSrc: (path: string) =>
    `asset://localhost/${encodeURIComponent(path)}`,
}))

describe("broadcast store sync", () => {
  beforeEach(async () => {
    emitMock.mockReset()
    emitMock.mockResolvedValue(undefined)
    invokeMock.mockReset()
    invokeMock.mockResolvedValue(undefined)
    vi.resetModules()
  })

  it("switches a background live on both outputs without changing verse or history", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const verse = { reference: "John 3:16", segments: [{ text: "For God so loved the world" }] }
    useBroadcastStore.setState({ liveVerse: verse, isLive: true })
    const history = useBroadcastStore.getState().history
    useBroadcastStore.getState().setBackground("scripture", "aurora-cool")
    for (const output of ["main", "alt"]) {
      expect(emitMock).toHaveBeenCalledWith(`broadcast:verse-update:${output}`, expect.objectContaining({
        verse,
        theme: expect.objectContaining({ background: expect.objectContaining({ type: "video" }) }),
      }))
    }
    expect(useBroadcastStore.getState().history).toBe(history)
    expect(useBroadcastStore.getState().liveVerse).toBe(verse)
  })

  it("remembers independent song and scripture backgrounds and restores the theme default", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const state = useBroadcastStore.getState()
    state.setBackground("scripture", "aurora-cool")
    state.setBackground("song", "still-waters")
    useBroadcastStore.setState({ liveVerse: { reference: "Song", hideReference: true, segments: [] } })
    emitMock.mockClear()
    state.syncBroadcastOutput()
    expect(emitMock).toHaveBeenCalledWith("broadcast:verse-update:main", expect.objectContaining({
      theme: expect.objectContaining({ background: expect.objectContaining({ type: "image", image: expect.objectContaining({ url: "/backgrounds/still-waters.png" }) }) }),
    }))
    expect(useBroadcastStore.getState().backgrounds.scripture.id).toBe("aurora-cool")
    state.setBackground("song", null)
    expect(emitMock).toHaveBeenLastCalledWith("broadcast:verse-update:alt", expect.objectContaining({ theme: state.themes[0] }))
  })

  it("warms projector assets when staging a verse without changing live output", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const verse = {
      reference: "John 3:16",
      segments: [{ text: "For God so loved the world" }],
    }
    useBroadcastStore.getState().setPreviewVerse(verse)
    for (const output of ["main", "alt"]) {
      expect(emitMock).toHaveBeenCalledWith(`broadcast:preload:${output}`, {
        theme: useBroadcastStore.getState().themes[0],
      })
    }
    expect(useBroadcastStore.getState().liveVerse).toBeNull()
    expect(
      emitMock.mock.calls.some(([event]) =>
        event.startsWith("broadcast:verse-update:")
      )
    ).toBe(false)
  })

  it("hides both outputs without losing the content needed by remote Show", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const verse = {
      reference: "John 3:16 (KJV)",
      segments: [{ text: "For God so loved the world", verseNumber: 16 }],
    }
    useBroadcastStore.setState({ liveVerse: verse, isLive: true })
    useBroadcastStore.getState().setLive(false)
    for (const output of ["main", "alt"])
      expect(emitMock).toHaveBeenCalledWith(
        `broadcast:verse-update:${output}`,
        expect.objectContaining({ hidden: true })
      )
    expect(useBroadcastStore.getState().liveVerse).toEqual(verse)
    emitMock.mockClear()
    useBroadcastStore.getState().setLive(true)
    for (const output of ["main", "alt"])
      expect(emitMock).toHaveBeenCalledWith(
        `broadcast:verse-update:${output}`,
        expect.objectContaining({ hidden: false, verse })
      )
  })

  it("sends the chosen video or still-image mode to both outputs", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const { useSettingsStore } = await import("./settings-store")
    const brand = useSettingsStore.getState().brand
    useSettingsStore.setState({
      brand: {
        ...brand,
        blankBackground: "video",
        blankVideoPath: "/managed/worship.mp4",
      },
    })
    useBroadcastStore.getState().setBlankLogo(true)
    for (const output of ["main", "alt"])
      expect(emitMock).toHaveBeenCalledWith(
        `broadcast:verse-update:${output}`,
        expect.objectContaining({
          blankLogo: true,
          blankVideoUrl: "asset://localhost/%2Fmanaged%2Fworship.mp4",
        })
      )
    emitMock.mockClear()
    useSettingsStore.setState({ brand: { ...brand, blankBackground: "image" } })
    useBroadcastStore.getState().syncBroadcastOutput()
    expect(emitMock).toHaveBeenCalledWith(
      "broadcast:verse-update:main",
      expect.objectContaining({ blankVideoUrl: null })
    )
  })

  it("syncBroadcastOutput emits current theme and verse for each output", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const theme = useBroadcastStore.getState().themes[0]
    useBroadcastStore.setState({
      activeThemeId: theme.id,
      liveVerse: {
        reference: "John 3:16",
        segments: [{ text: "For God so loved the world", verseNumber: 16 }],
      },
    })

    emitMock.mockClear()
    useBroadcastStore.getState().syncBroadcastOutput()

    expect(emitMock).toHaveBeenCalledTimes(3)
    expect(emitMock).toHaveBeenCalledWith(
      "projector:calibration",
      expect.objectContaining({ editing: false })
    )
    expect(emitMock).toHaveBeenCalledWith(
      "broadcast:verse-update:main",
      expect.objectContaining({
        theme: expect.objectContaining({ id: theme.id }),
        verse: expect.objectContaining({ reference: "John 3:16" }),
      })
    )
    expect(emitMock).toHaveBeenCalledWith(
      "broadcast:verse-update:alt",
      expect.objectContaining({
        theme: expect.objectContaining({ id: theme.id }),
        verse: expect.objectContaining({ reference: "John 3:16" }),
      })
    )
  })

  it("updates nested draft fields used by designer sliders", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const builtin = useBroadcastStore.getState().themes[0]

    useBroadcastStore.getState().startEditing(builtin.id)
    useBroadcastStore.getState().updateDraftNested("verseText.fontSize", 88)

    expect(useBroadcastStore.getState().draftTheme?.verseText.fontSize).toBe(88)
  })

  it("keeps passage highlights in live output and history", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const highlighted = {
      reference: "John 3:16 (KJV)",
      segments: [{ text: "For God so loved", verseNumber: 16 }],
      highlights: [
        {
          segmentIndex: 0,
          start: 4,
          end: 7,
          color: "#FACC15",
          sourceText: "God",
        },
      ],
    }

    useBroadcastStore.getState().setLiveVerse(highlighted)

    expect(useBroadcastStore.getState().liveVerse?.highlights).toEqual(
      highlighted.highlights
    )
    expect(
      useBroadcastStore.getState().history.at(-1)?.verse.highlights
    ).toEqual(highlighted.highlights)
  })

  it("updates an already-live highlight without adding another history entry", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const verse = {
      reference: "John 3:16 (KJV)",
      segments: [{ text: "For God so loved", verseNumber: 16 }],
    }
    useBroadcastStore.setState({
      liveVerse: verse,
      isLive: true,
      history: [{ verse, presentedAt: 10 }],
    })
    emitMock.mockClear()

    useBroadcastStore.getState().updateLiveVerseHighlights([
      {
        segmentIndex: 0,
        start: 4,
        end: 7,
        color: "#FACC15",
        sourceText: "God",
      },
    ])

    const state = useBroadcastStore.getState()
    expect(state.liveVerse?.highlights).toHaveLength(1)
    expect(state.history).toHaveLength(1)
    expect(state.history[0].verse.highlights).toHaveLength(1)
    expect(emitMock).toHaveBeenCalledWith(
      "broadcast:verse-update:main",
      expect.objectContaining({
        verse: expect.objectContaining({ highlights: expect.any(Array) }),
      })
    )
  })

  it("saving a draft based on a built-in persists the new custom theme", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const builtin = useBroadcastStore.getState().themes[0]

    useBroadcastStore.getState().startEditing(builtin.id)
    await useBroadcastStore.getState().saveDraft()

    const custom = useBroadcastStore.getState().draftTheme
    expect(custom).toEqual(
      expect.objectContaining({
        builtin: false,
        name: `${builtin.name} (Custom)`,
      })
    )
    expect(invokeMock).toHaveBeenCalledWith(
      "save_custom_theme",
      expect.objectContaining({
        id: custom?.id,
        name: custom?.name,
        themeJson: expect.stringContaining(`"id":"${custom?.id}"`),
      })
    )
  })

  it("duplicating a theme selects and edits the new custom copy", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const builtin = useBroadcastStore.getState().themes[0]

    useBroadcastStore.getState().duplicateTheme(builtin.id)

    const state = useBroadcastStore.getState()
    const copy = state.draftTheme
    expect(state.themes).toHaveLength(6)
    expect(copy).toEqual(expect.objectContaining({ builtin: false }))
    expect(state.editingThemeId).toBe(copy?.id)
    expect(state.draftTheme?.id).toBe(copy?.id)
  })

  it("does not mirror a second queue item for the same canonical verse in another translation", async () => {
    const [{ useBroadcastStore }, { useBibleStore }, { useQueueStore }] =
      await Promise.all([
        import("./broadcast-store"),
        import("./bible-store"),
        import("./queue-store"),
      ])
    const kjv = {
      id: 1,
      translation_id: 1,
      book_number: 43,
      book_name: "John",
      book_abbreviation: "Jn",
      chapter: 3,
      verse: 16,
      text: "KJV",
    }
    useQueueStore.setState({
      items: [
        {
          kind: "verse",
          id: "existing",
          source: "manual",
          added_at: 1,
          verse: kjv,
          confidence: 1,
          reference: "John 3:16",
        },
      ],
      activeIndex: 0,
    })
    useBibleStore.setState({
      selectedVerse: { ...kjv, id: 2, translation_id: 2, text: "NIV" },
    })

    useBroadcastStore.getState().setLiveVerse({
      reference: "John 3:16 (NIV)",
      segments: [{ text: "NIV", verseNumber: 16 }],
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(useQueueStore.getState().items).toHaveLength(1)
    expect(useQueueStore.getState().items[0].id).toBe("existing")
  })
})
