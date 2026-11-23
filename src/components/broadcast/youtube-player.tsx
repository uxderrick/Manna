import { useEffect, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { emit, listen } from "@tauri-apps/api/event"
import {
  isYouTubeCommand,
  parseYouTubeLink,
  playerAddress,
  readPlayerStatus,
  type YouTubeCommand,
  type YouTubeStatus,
} from "@/lib/youtube"

export function YouTubePlayer({
  url,
  muted,
  volume = 100,
}: {
  url: string
  muted: boolean
  volume?: number
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const originRef = useRef("")
  const volumeRef = useRef(volume)
  const [visible, setVisible] = useState(false)
  const [address, setAddress] = useState<string | null>(null)
  const [error, setError] = useState("")
  useEffect(() => {
    volumeRef.current = volume
    if (originRef.current)
      frame.current?.contentWindow?.postMessage(
        {
          type: "manna-youtube-command",
          command: { action: "volume", volume },
        },
        originRef.current
      )
  }, [volume])
  useEffect(() => {
    let disposed = false
    let wasShown: boolean | undefined
    const check = () => {
      void invoke<boolean>("youtube_output_visible")
        .then((shown) => {
          if (disposed) return
          const active = shown && document.visibilityState !== "hidden"
          setVisible(active)
          if (!active && wasShown !== false && !muted) {
            void emit("broadcast:youtube-status", {
              url,
              state: "paused",
              message: "Show the main output window to play YouTube.",
            }).catch(() => {})
          }
          wasShown = active
        })
        .catch(() => {
          if (!disposed) setVisible(false)
        })
    }
    check()
    const timer = setInterval(check, 500)
    document.addEventListener("visibilitychange", check)
    return () => {
      disposed = true
      clearInterval(timer)
      document.removeEventListener("visibilitychange", check)
    }
  }, [url, muted])
  useEffect(() => {
    if (!visible) return
    let disposed = false
    let origin = ""
    let timer: ReturnType<typeof setTimeout> | undefined
    const link = parseYouTubeLink(url)
    const report = (status: Omit<YouTubeStatus, "url">) => {
      if (!muted)
        void emit("broadcast:youtube-status", { url, ...status }).catch(
          () => {}
        )
    }
    const fail = (message: string) => {
      if (disposed) return
      setError(message)
      report({ state: "error", message })
    }
    if (!link) {
      fail("Invalid YouTube link.")
      return
    }
    void invoke<string>("youtube_player_url")
      .then((value) => {
        if (disposed) return
        const target = playerAddress(value)
        if (!target) throw new Error("Invalid local YouTube player address.")
        origin = target.origin
        originRef.current = origin
        target.searchParams.set("video", link.videoId)
        target.searchParams.set("start", String(link.startSeconds))
        target.searchParams.set("muted", muted ? "1" : "0")
        target.searchParams.set("volume", String(volumeRef.current))
        setAddress(target.href)
        timer = setTimeout(
          () =>
            fail(
              "YouTube did not start. Check the internet connection and try Live again."
            ),
          25000
        )
      })
      .catch((error) =>
        fail(error instanceof Error ? error.message : String(error))
      )
    const onMessage = (event: MessageEvent) => {
      const status = readPlayerStatus(
        event,
        frame.current?.contentWindow ?? null,
        origin,
        link.videoId
      )
      if (!status || disposed) return
      clearTimeout(timer)
      report(status)
      if (status.state === "playing")
        frame.current?.contentWindow?.postMessage(
          {
            type: "manna-youtube-command",
            command: { action: "volume", volume: volumeRef.current },
          },
          origin
        )
      if (status.state === "error")
        setError(status.message || "YouTube playback failed.")
    }
    window.addEventListener("message", onMessage)
    const cleanup = listen<{ url: string; command: YouTubeCommand }>(
      "broadcast:youtube-control",
      (event) => {
        if (
          !disposed &&
          event.payload.url === url &&
          isYouTubeCommand(event.payload.command) &&
          origin
        )
          frame.current?.contentWindow?.postMessage(
            { type: "manna-youtube-command", command: event.payload.command },
            origin
          )
      }
    )
    return () => {
      disposed = true
      clearTimeout(timer)
      window.removeEventListener("message", onMessage)
      void cleanup.then((unlisten) => unlisten())
    }
  }, [url, muted, visible])
  if (!visible) return null
  if (error)
    return (
      <div
        role="alert"
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "black",
          color: "white",
        }}
      >
        Video unavailable
      </div>
    )
  if (!address) return null
  return (
    <iframe
      ref={frame}
      title="YouTube live video"
      src={address}
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        border: 0,
      }}
    />
  )
}
