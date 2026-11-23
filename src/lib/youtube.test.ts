import { afterEach, expect, it, vi } from "vitest"
import {
  parseYouTubeLink,
  loadYouTubeLinks,
  saveYouTubeLinks,
  isYouTubeCommand,
  playerAddress,
  readPlayerStatus,
} from "./youtube"
afterEach(() => vi.unstubAllGlobals())
it("accepts official links and preserves the requested start time", () => {
  for (const url of [
    "https://youtu.be/M7lc1UVf-VE?t=1m2s",
    "https://www.youtube.com/watch?v=M7lc1UVf-VE&t=62",
    "https://youtube.com/live/M7lc1UVf-VE?start=62",
    "https://youtube.com/shorts/M7lc1UVf-VE?t=62",
    "https://www.youtube-nocookie.com/embed/M7lc1UVf-VE?start=62",
  ]) {
    expect(parseYouTubeLink(url, "Worship")).toMatchObject({
      videoId: "M7lc1UVf-VE",
      startSeconds: 62,
      label: "Worship",
      url: "https://www.youtube.com/watch?v=M7lc1UVf-VE&t=62",
    })
  }
})
it("rejects spoofed hosts, arbitrary URLs and invalid times or IDs", () => {
  for (const url of [
    "https://youtube.com.evil.test/watch?v=M7lc1UVf-VE",
    "javascript:alert(1)",
    "https://youtube.com@evil.test/watch?v=M7lc1UVf-VE",
    "https://youtu.be/bad",
    "https://youtube.com/watch?v=M7lc1UVf-VE&t=-1",
    "https://youtube.com/watch?v=M7lc1UVf-VE&t=NaN",
    "https://youtube.com/watch?v=M7lc1UVf-VE&t=999999999999999",
    "https://youtu.be:8080/M7lc1UVf-VE",
  ])
    expect(parseYouTubeLink(url)).toBeNull()
})
it("restores only valid saved links and persists just link metadata", () => {
  let saved = JSON.stringify([
    { url: "https://youtu.be/M7lc1UVf-VE", label: "Worship" },
    { url: "https://evil.test/", label: "Bad" },
  ])
  vi.stubGlobal("localStorage", {
    getItem: () => saved,
    setItem: (_key: string, value: string) => {
      saved = value
    },
  })
  expect(loadYouTubeLinks()).toHaveLength(1)
  saveYouTubeLinks(loadYouTubeLinks())
  expect(JSON.parse(saved)).toEqual([
    { url: "https://www.youtube.com/watch?v=M7lc1UVf-VE", label: "Worship" },
  ])
  saved = "broken"
  expect(loadYouTubeLinks()).toEqual([])
})
it("accepts only supported playback commands and volume bounds", () => {
  expect(isYouTubeCommand({ action: "play" })).toBe(true)
  expect(isYouTubeCommand({ action: "volume", volume: 70 })).toBe(true)
  for (const command of [
    { action: "eval" },
    { action: "volume", volume: NaN },
    { action: "volume", volume: 101 },
    { action: "volume", volume: -1 },
  ])
    expect(isYouTubeCommand(command)).toBe(false)
})

it("accepts only the local player endpoint", () => {
  expect(
    playerAddress("http://127.0.0.1:43111/youtube-player.html")?.port
  ).toBe("43111")
  for (const url of [
    "https://evil.test/youtube-player.html",
    "http://127.0.0.1:43111/other",
    "http://127.0.0.1:43111/youtube-player.html?code=bad",
  ])
    expect(playerAddress(url)).toBeNull()
})
it("ignores messages from other frames, origins, videos and unsupported states", () => {
  const frame = {} as Window
  const data = {
    type: "manna-youtube-status",
    videoId: "M7lc1UVf-VE",
    state: "playing",
  }
  const event = { source: frame, origin: "http://127.0.0.1:43111", data }
  expect(
    readPlayerStatus(event, frame, event.origin, data.videoId)?.state
  ).toBe("playing")
  expect(
    readPlayerStatus(
      { ...event, source: {} as Window },
      frame,
      event.origin,
      data.videoId
    )
  ).toBeNull()
  expect(
    readPlayerStatus(
      { ...event, origin: "https://evil.test" },
      frame,
      event.origin,
      data.videoId
    )
  ).toBeNull()
  expect(
    readPlayerStatus(event, frame, event.origin, "different-id")
  ).toBeNull()
  expect(
    readPlayerStatus(
      { ...event, data: { ...data, state: "eval" } },
      frame,
      event.origin,
      data.videoId
    )
  ).toBeNull()
})
