import { useState } from "react"
import { CheckIcon, ChevronDownIcon, ImageIcon, PlayIcon } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useBroadcastStore } from "@/stores/broadcast-store"
import {
  BACKGROUND_MEDIA,
  type BackgroundContext,
} from "@/lib/live-backgrounds"

export function BackgroundPicker({ context }: { context: BackgroundContext }) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<"all" | "video" | "image">("all")
  const choice = useBroadcastStore((state) => state.backgrounds[context])
  const setBackground = useBroadcastStore((state) => state.setBackground)
  const setDimming = useBroadcastStore((state) => state.setBackgroundDimming)
  const selected = BACKGROUND_MEDIA.find((media) => media.id === choice.id)
  const label = context === "song" ? "Songs" : "Scripture"

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          aria-label={`${label} background`}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded border border-white/10 bg-white/5 px-2 py-1.5 text-left text-[10px] text-white/70 hover:bg-white/10"
        >
          <ImageIcon className="size-3 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <span className="max-w-20 truncate text-white/45">
            {selected?.name ?? "Theme"}
          </span>
          <ChevronDownIcon className="size-3 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        aria-label={`${label} backgrounds`}
        align="end"
        className="w-[520px] max-w-[calc(100vw-24px)] gap-3 p-3"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{label} background</span>
          <button
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => {
              setBackground(context, null)
              setOpen(false)
            }}
          >
            Theme default
          </button>
        </div>
        <div className="flex gap-1" role="group" aria-label="Background types">
          {(["all", "video", "image"] as const).map((kind) => (
            <button
              key={kind}
              aria-pressed={filter === kind}
              className={`rounded px-2 py-1 text-xs ${filter === kind ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
              onClick={() => setFilter(kind)}
            >
              {{ all: "All", video: "Loops", image: "Images" }[kind]}
            </button>
          ))}
        </div>
        <div className="grid max-h-[min(480px,55vh)] grid-cols-2 gap-3 overflow-y-auto">
          {BACKGROUND_MEDIA.filter(
            (media) => filter === "all" || media.kind === filter
          ).map((media) => (
            <button
              key={media.id}
              aria-label={`Use ${media.name} background`}
              aria-pressed={media.id === choice.id}
              onClick={() => {
                setBackground(context, media.id)
                setOpen(false)
              }}
              className={`relative overflow-hidden rounded border text-left ${media.id === choice.id ? "border-primary ring-1 ring-primary" : "border-border hover:border-muted-foreground"}`}
            >
              <img
                src={media.thumbnail}
                alt=""
                loading="lazy"
                className="aspect-video w-full object-cover"
              />
              <span className="flex items-center gap-1.5 px-2 py-2 text-xs">
                {media.kind === "video" && (
                  <PlayIcon className="size-3 shrink-0" />
                )}
                {media.name}
                {media.id === choice.id && (
                  <CheckIcon className="ml-auto size-3 shrink-0" />
                )}
              </span>
            </button>
          ))}
        </div>
        {selected && (
          <label className="flex items-center gap-2 text-xs">
            Darken
            <input
              aria-label={`${label} background darkness`}
              type="range"
              min={0}
              max={80}
              step={5}
              value={Math.round(choice.dimming * 100)}
              className="min-w-0 flex-1 accent-primary"
              onChange={(event) =>
                setDimming(context, Number(event.target.value) / 100)
              }
            />
            <span className="w-7 text-right tabular-nums">
              {Math.round(choice.dimming * 100)}%
            </span>
          </label>
        )}
      </PopoverContent>
    </Popover>
  )
}
