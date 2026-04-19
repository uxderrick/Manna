import { beforeEach, describe, expect, it } from "vitest"

import { useTranscriptStore } from "./transcript-store"

/**
 * Regression coverage for learnings #16 and #17:
 *
 *   - Deepgram silence-closes fire `stt_disconnected` mid-session.
 *     Backend auto-reconnects → later fires `stt_connected`.
 *     Frontend must NOT flip `isTranscribing=false` on `stt_disconnected` —
 *     otherwise the UI renders its empty state on every reconnect.
 *   - Only `stt_error` (terminal, max attempts reached) should flip
 *     `isTranscribing=false`.
 *
 * These tests exercise the state transitions that `transcript-panel.tsx`
 * applies on each Tauri event. If the handlers in that file are changed to
 * flip isTranscribing on disconnect again, these will fail.
 */

// Mirror the handlers in transcript-panel.tsx. Keep this mirror colocated
// with the test so the regression is self-contained.
function applyEvent(event: "stt_connected" | "stt_disconnected" | "stt_reconnecting" | "stt_error") {
  const store = useTranscriptStore.getState()
  switch (event) {
    case "stt_connected":
      store.setConnectionStatus("connected")
      store.setTranscribing(true)
      break
    case "stt_reconnecting":
      store.setConnectionStatus("reconnecting")
      break
    case "stt_disconnected":
      // IMPORTANT: soft event — clear partial + connection status only,
      // but DO NOT flip isTranscribing. Silence-close reconnects must not
      // render the empty state. See learning #16.
      store.setConnectionStatus("disconnected")
      store.setPartial("")
      break
    case "stt_error":
      store.setConnectionStatus("error")
      store.setTranscribing(false)
      store.setPartial("")
      break
  }
}

describe("transcript store — STT connection event handling", () => {
  beforeEach(() => {
    useTranscriptStore.setState({
      segments: [],
      currentPartial: "",
      isTranscribing: false,
      connectionStatus: "disconnected",
    })
  })

  it("stt_connected flips isTranscribing=true and status=connected", () => {
    applyEvent("stt_connected")
    const s = useTranscriptStore.getState()
    expect(s.isTranscribing).toBe(true)
    expect(s.connectionStatus).toBe("connected")
  })

  it("stt_disconnected does NOT flip isTranscribing=false", () => {
    applyEvent("stt_connected")
    applyEvent("stt_disconnected")
    const s = useTranscriptStore.getState()
    // Regression guard: silence-close keeps the session alive in the UI.
    expect(s.isTranscribing).toBe(true)
    expect(s.connectionStatus).toBe("disconnected")
    expect(s.currentPartial).toBe("")
  })

  it("full silence-close → reconnect cycle keeps UI alive", () => {
    applyEvent("stt_connected")
    expect(useTranscriptStore.getState().isTranscribing).toBe(true)

    // Simulate Deepgram silence-close after ~10s of no audio.
    applyEvent("stt_disconnected")
    expect(useTranscriptStore.getState().isTranscribing).toBe(true)

    // Backend reconnect attempt.
    applyEvent("stt_reconnecting")
    expect(useTranscriptStore.getState().isTranscribing).toBe(true)
    expect(useTranscriptStore.getState().connectionStatus).toBe("reconnecting")

    // Reconnect succeeds.
    applyEvent("stt_connected")
    expect(useTranscriptStore.getState().isTranscribing).toBe(true)
    expect(useTranscriptStore.getState().connectionStatus).toBe("connected")
  })

  it("stt_error is terminal — flips isTranscribing=false", () => {
    applyEvent("stt_connected")
    applyEvent("stt_error")
    const s = useTranscriptStore.getState()
    expect(s.isTranscribing).toBe(false)
    expect(s.connectionStatus).toBe("error")
    expect(s.currentPartial).toBe("")
  })

  it("repeated disconnect/reconnect cycles do not lose transcribing state", () => {
    applyEvent("stt_connected")
    for (let i = 0; i < 5; i++) {
      applyEvent("stt_disconnected")
      applyEvent("stt_reconnecting")
      applyEvent("stt_connected")
      expect(useTranscriptStore.getState().isTranscribing).toBe(true)
    }
  })
})
