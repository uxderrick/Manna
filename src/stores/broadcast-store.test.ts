import { beforeEach, describe, expect, it, vi } from "vitest"

const emitMock = vi.fn()

vi.mock("@tauri-apps/api/event", () => ({
  emit: emitMock,
}))

describe("broadcast store sync", () => {
  beforeEach(async () => {
    emitMock.mockReset()
    emitMock.mockResolvedValue(undefined)
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

    expect(emitMock).toHaveBeenCalledTimes(2)
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
})
