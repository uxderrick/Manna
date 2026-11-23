export interface YouTubeLink {
  videoId: string
  startSeconds: number
  url: string
  label: string
  poster: string
}

const STORAGE_KEY = "manna-youtube-links"
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

export function parseYouTubeLink(
  input: string,
  label = ""
): YouTubeLink | null {
  try {
    const url = new URL(input.trim())
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port
    )
      return null
    const host = url.hostname.toLowerCase()
    const parts = url.pathname.split("/").filter(Boolean)
    const id =
      host === "youtu.be"
        ? parts.length === 1
          ? parts[0]
          : ""
        : [
              "youtube.com",
              "www.youtube.com",
              "m.youtube.com",
              "www.youtube-nocookie.com",
            ].includes(host)
          ? url.pathname === "/watch"
            ? url.searchParams.get("v")
            : ["shorts", "live", "embed"].includes(parts[0]) &&
                parts.length === 2
              ? parts[1]
              : ""
          : ""
    if (!id || !VIDEO_ID.test(id)) return null
    const time =
      url.searchParams.get("t") ?? url.searchParams.get("start") ?? "0"
    const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(time)
    const startSeconds = /^\d+$/.test(time)
      ? Number(time)
      : match && time
        ? Number(match[1] ?? 0) * 3600 +
          Number(match[2] ?? 0) * 60 +
          Number(match[3] ?? 0)
        : NaN
    if (
      !Number.isSafeInteger(startSeconds) ||
      startSeconds < 0 ||
      startSeconds > 604800
    )
      return null
    return {
      videoId: id,
      startSeconds,
      url: `https://www.youtube.com/watch?v=${id}${startSeconds ? `&t=${startSeconds}` : ""}`,
      label: label.trim().slice(0, 160) || `YouTube · ${id}`,
      poster: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    }
  } catch {
    return null
  }
}

export function loadYouTubeLinks(): YouTubeLink[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")
    if (!Array.isArray(saved)) return []
    const links = saved.flatMap((item) => {
      if (!item || typeof item.url !== "string") return []
      const link = parseYouTubeLink(
        item.url,
        typeof item.label === "string" ? item.label : ""
      )
      return link ? [link] : []
    })
    return [...new Map(links.map((link) => [link.videoId, link])).values()]
  } catch {
    return []
  }
}

export function saveYouTubeLinks(links: YouTubeLink[]): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(links.map(({ url, label }) => ({ url, label })))
  )
}

export type YouTubeCommand =
  | { action: "play" | "pause" }
  | { action: "volume"; volume: number }
export interface YouTubeStatus {
  url: string
  state: "playing" | "paused" | "ended" | "blocked" | "error"
  message?: string
}

export function isYouTubeCommand(value: unknown): value is YouTubeCommand {
  if (!value || typeof value !== "object") return false
  const command = value as Record<string, unknown>
  return (
    command.action === "play" ||
    command.action === "pause" ||
    (command.action === "volume" &&
      typeof command.volume === "number" &&
      Number.isFinite(command.volume) &&
      command.volume >= 0 &&
      command.volume <= 100)
  )
}

export function playerAddress(input: string): URL | null {
  try {
    const url = new URL(input)
    return url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      !!url.port &&
      !url.username &&
      !url.password &&
      url.pathname === "/youtube-player.html" &&
      !url.search &&
      !url.hash
      ? url
      : null
  } catch {
    return null
  }
}

export function readPlayerStatus(
  event: Pick<MessageEvent, "source" | "origin" | "data">,
  frame: Window | null,
  origin: string,
  videoId: string
): Omit<YouTubeStatus, "url"> | null {
  if (
    !frame ||
    event.source !== frame ||
    event.origin !== origin ||
    event.data?.type !== "manna-youtube-status" ||
    event.data.videoId !== videoId
  )
    return null
  const { state, message } = event.data
  if (!["playing", "paused", "ended", "blocked", "error"].includes(state))
    return null
  return {
    state,
    message: typeof message === "string" ? message.slice(0, 500) : undefined,
  }
}
