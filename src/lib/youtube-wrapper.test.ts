import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { expect, it, vi } from "vitest"
const html = readFileSync(
  new URL("../../src-tauri/src/commands/youtube-player.html", import.meta.url),
  "utf8"
)
const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]
function setup(muted: boolean, volume = 100) {
  const player = {
    playVideo: vi.fn(),
    pauseVideo: vi.fn(),
    mute: vi.fn(),
    unMute: vi.fn(),
    setVolume: vi.fn(),
  }
  let settings!: {
    events: { onReady: (event: { target: typeof player }) => void }
  }
  let onMessage!: (event: { source: unknown; data: unknown }) => void
  const parent = { postMessage: vi.fn() }
  const window = {
    onYouTubeIframeAPIReady: () => {},
    addEventListener: (_name: string, callback: typeof onMessage) => {
      onMessage = callback
    },
  }
  runInNewContext(script, {
    window,
    parent,
    URLSearchParams,
    location: {
      search: `?video=M7lc1UVf-VE&muted=${muted ? 1 : 0}&volume=${volume}`,
      origin: "http://127.0.0.1:3002",
    },
    document: { createElement: () => ({}), head: { append: vi.fn() } },
    YT: {
      Player: class {
        constructor(_id: string, options: typeof settings) {
          settings = options
          return player
        }
      },
    },
  })
  window.onYouTubeIframeAPIReady()
  settings.events.onReady({ target: player })
  return { player, parent, onMessage }
}
it("starts the main player unmuted at full volume and rejects commands from other windows", () => {
  const { player, parent, onMessage } = setup(false)
  expect(player.unMute).toHaveBeenCalledOnce()
  expect(player.setVolume).toHaveBeenCalledWith(100)
  expect(player.playVideo).toHaveBeenCalledOnce()
  onMessage({
    source: {},
    data: { type: "manna-youtube-command", command: { action: "pause" } },
  })
  expect(player.pauseVideo).not.toHaveBeenCalled()
  onMessage({
    source: parent,
    data: { type: "manna-youtube-command", command: { action: "pause" } },
  })
  expect(player.pauseVideo).toHaveBeenCalledOnce()
})
it("keeps the alternate player muted even when a volume command arrives", () => {
  const { player, parent, onMessage } = setup(true)
  expect(player.mute).toHaveBeenCalledOnce()
  expect(player.unMute).not.toHaveBeenCalled()
  onMessage({
    source: parent,
    data: {
      type: "manna-youtube-command",
      command: { action: "volume", volume: 100 },
    },
  })
  expect(player.setVolume).toHaveBeenCalledWith(0)
})

it("restores the selected volume before starting a visible output", () => {
  const { player } = setup(false, 35)
  expect(player.setVolume).toHaveBeenCalledWith(35)
})
