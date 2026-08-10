import { beforeEach, describe, expect, it, vi } from "vitest"

const emitMock = vi.fn()
const invokeMock = vi.fn()

vi.mock("@tauri-apps/api/event", () => ({
  emit: emitMock,
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}))

describe("broadcast store sync", () => {
  beforeEach(async () => {
    emitMock.mockReset()
    emitMock.mockResolvedValue(undefined)
    invokeMock.mockReset()
    invokeMock.mockResolvedValue(undefined)
    vi.resetModules()
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
      expect.objectContaining({ editing: false }),
    )
    expect(emitMock).toHaveBeenCalledWith(
      "broadcast:verse-update:main",
      expect.objectContaining({
        theme: expect.objectContaining({ id: theme.id }),
        verse: expect.objectContaining({ reference: "John 3:16" }),
      }),
    )
    expect(emitMock).toHaveBeenCalledWith(
      "broadcast:verse-update:alt",
      expect.objectContaining({
        theme: expect.objectContaining({ id: theme.id }),
        verse: expect.objectContaining({ reference: "John 3:16" }),
      }),
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
        { segmentIndex: 0, start: 4, end: 7, color: "#FACC15", sourceText: "God" },
      ],
    }

    useBroadcastStore.getState().setLiveVerse(highlighted)

    expect(useBroadcastStore.getState().liveVerse?.highlights).toEqual(highlighted.highlights)
    expect(useBroadcastStore.getState().history.at(-1)?.verse.highlights).toEqual(highlighted.highlights)
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
      { segmentIndex: 0, start: 4, end: 7, color: "#FACC15", sourceText: "God" },
    ])

    const state = useBroadcastStore.getState()
    expect(state.liveVerse?.highlights).toHaveLength(1)
    expect(state.history).toHaveLength(1)
    expect(state.history[0].verse.highlights).toHaveLength(1)
    expect(emitMock).toHaveBeenCalledWith(
      "broadcast:verse-update:main",
      expect.objectContaining({ verse: expect.objectContaining({ highlights: expect.any(Array) }) }),
    )
  })

  it("saving a draft based on a built-in persists the new custom theme", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const builtin = useBroadcastStore.getState().themes[0]

    useBroadcastStore.getState().startEditing(builtin.id)
    useBroadcastStore.getState().saveDraft()

    const custom = useBroadcastStore.getState().draftTheme
    expect(custom).toEqual(expect.objectContaining({
      builtin: false,
      name: `${builtin.name} (Custom)`,
    }))
    expect(invokeMock).toHaveBeenCalledWith(
      "save_custom_theme",
      expect.objectContaining({
        id: custom?.id,
        name: custom?.name,
        themeJson: expect.stringContaining(`"id":"${custom?.id}"`),
      }),
    )
  })

  it("duplicating a theme selects and edits the new custom copy", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const builtin = useBroadcastStore.getState().themes[0]

    useBroadcastStore.getState().duplicateTheme(builtin.id)

    const state = useBroadcastStore.getState()
    const copy = state.themes.find((theme) => theme.name === `${builtin.name} Copy`)
    expect(copy).toEqual(expect.objectContaining({ builtin: false }))
    expect(state.editingThemeId).toBe(copy?.id)
    expect(state.draftTheme?.id).toBe(copy?.id)
  })
})
