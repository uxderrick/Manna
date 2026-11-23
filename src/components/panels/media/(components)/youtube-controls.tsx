import { useEffect, useState } from "react"
import { emit, listen } from "@tauri-apps/api/event"
import { PlayIcon, PauseIcon, SquareIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useBroadcastStore } from "@/stores/broadcast-store"
import type { ImageSlide } from "@/types"
import type { YouTubeCommand, YouTubeStatus } from "@/lib/youtube"

export function YouTubeControls() {
  const slide = useBroadcastStore((state) => state.fullscreenImage)
  return slide?.mediaType === "youtube" ? (
    <PlaybackControls key={slide.playbackId ?? slide.url} slide={slide} />
  ) : null
}

function PlaybackControls({ slide }: { slide: ImageSlide }) {
  const [status, setStatus] = useState<YouTubeStatus | null>(null)
  const [error, setError] = useState("")
  useEffect(() => {
    let disposed = false
    const cleanup = listen<YouTubeStatus>(
      "broadcast:youtube-status",
      (event) => {
        if (!disposed) setStatus(event.payload)
      }
    )
    return () => {
      disposed = true
      void cleanup.then((unlisten) => unlisten())
    }
  }, [])
  const current = status?.url === slide.url ? status : null
  const send = (command: YouTubeCommand) => {
    setError("")
    void emit("broadcast:youtube-control", { url: slide.url, command }).catch(
      () => setError("Could not reach the output player.")
    )
  }
  return (
    <section
      aria-label="YouTube playback"
      className="grid gap-2 border-b border-border/40 px-3 py-2"
    >
      <p className="truncate text-xs font-medium">{slide.label}</p>
      <div className="flex items-center gap-2">
        <Button
          size="xs"
          variant="outline"
          aria-label="Play YouTube"
          onClick={() => send({ action: "play" })}
        >
          <PlayIcon className="size-3" />
        </Button>
        <Button
          size="xs"
          variant="outline"
          aria-label="Pause YouTube"
          onClick={() => send({ action: "pause" })}
        >
          <PauseIcon className="size-3" />
        </Button>
        <Button
          size="xs"
          variant="outline"
          aria-label="Stop YouTube"
          onClick={() => useBroadcastStore.getState().setFullscreenImage(null)}
        >
          <SquareIcon className="size-3" />
        </Button>
        <label className="flex min-w-0 flex-1 items-center gap-2 text-xs">
          Volume
          <input
            aria-label="YouTube volume"
            className="min-w-0 flex-1 accent-primary"
            type="range"
            min={0}
            max={100}
            value={slide.volume ?? 100}
            onChange={(event) => {
              const value = Number(event.target.value)
              useBroadcastStore.getState().setYouTubeVolume(value)
            }}
          />
        </label>
      </div>
      <p role="status" className="text-xs text-muted-foreground">
        {error ||
          current?.message ||
          current?.state ||
          "Connecting to the main output…"}
      </p>
    </section>
  )
}
