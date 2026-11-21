import { memo, useEffect, useRef, useState, type KeyboardEvent } from "react"
import { PlayIcon, PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SourceBadge } from "./source-badge"
import type { Song } from "@/types"

const ROW_HEIGHT = 64
const OVERSCAN = 6

interface Props {
  songs: Song[]
  onOpen: (id: string) => void
  onAdd: (id: string) => void
  onJump: (id: string) => void
}

export const SongResults = memo(function SongResults(props: Props) {
  const { songs } = props
  const viewport = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(600)
  const [focusedRow, setFocusedRow] = useState<number | null>(null)

  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) =>
      setHeight(entry.contentRect.height)
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const end = Math.min(
    songs.length,
    Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN
  )
  const visible = Array.from(
    { length: Math.max(0, end - start) },
    (_, offset) => start + offset
  )
  // Keep a focused row mounted even if the user scrolls it out of view.
  if (
    focusedRow !== null &&
    (focusedRow < start || focusedRow >= end) &&
    songs[focusedRow]
  ) {
    visible.push(focusedRow)
    visible.sort((a, b) => a - b)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return
    const button = event.target as HTMLButtonElement
    const row = button.closest<HTMLElement>("[data-song-index]")
    if (!row) return
    const buttons = Array.from(row.querySelectorAll("button"))
    const position = buttons.indexOf(button) + (event.shiftKey ? -1 : 1)
    if (position >= 0 && position < buttons.length) return
    const nextRow = Number(row.dataset.songIndex) + (event.shiftKey ? -1 : 1)
    if (nextRow < 0 || nextRow >= songs.length) return
    if (viewport.current?.querySelector(`[data-song-index="${nextRow}"]`))
      return
    event.preventDefault()
    const top = nextRow * ROW_HEIGHT
    viewport.current!.scrollTop = top
    setScrollTop(top)
    requestAnimationFrame(() => {
      const targets = viewport.current?.querySelectorAll<HTMLButtonElement>(
        `[data-song-index="${nextRow}"] button`
      )
      targets?.[event.shiftKey ? targets.length - 1 : 0]?.focus()
    })
  }

  return (
    <div
      ref={viewport}
      className="min-h-0 flex-1 overflow-auto"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      onKeyDown={handleKeyDown}
      onFocusCapture={(event) => {
        const row = (event.target as HTMLElement).closest<HTMLElement>(
          "[data-song-index]"
        )
        if (row) setFocusedRow(Number(row.dataset.songIndex))
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setFocusedRow(null)
      }}
    >
      <ul
        aria-label="Songs"
        className="relative"
        style={{ height: songs.length * ROW_HEIGHT }}
      >
        {visible.map((index) => (
          <SongRow
            key={songs[index].id}
            {...props}
            song={songs[index]}
            index={index}
          />
        ))}
      </ul>
    </div>
  )
})

function SongRow({
  song,
  index,
  songs,
  onOpen,
  onAdd,
  onJump,
}: Props & { song: Song; index: number }) {
  return (
    <li
      data-song-index={index}
      aria-posinset={index + 1}
      aria-setsize={songs.length}
      style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
      className="group absolute flex w-full items-center gap-3 border-b border-border/40 p-3 transition-colors hover:bg-muted/40"
    >
      <SourceBadge source={song.source} />
      <button
        onClick={() => onOpen(song.id)}
        className="min-w-0 flex-1 text-left"
      >
        <div className="flex items-baseline gap-2">
          {song.number !== null && (
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {song.number}
            </span>
          )}
          <span className="truncate text-sm font-medium">{song.title}</span>
        </div>
        {song.author && (
          <div className="truncate text-xs text-muted-foreground">
            {song.author}
          </div>
        )}
      </button>
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <Button
          size="xs"
          variant="default"
          onClick={() => onJump(song.id)}
          className="h-6 gap-1 px-2 text-[10px]"
          title="Broadcast immediately"
        >
          <PlayIcon className="size-2.5" />
          Go Live
        </Button>
        <Button
          size="xs"
          variant="outline"
          onClick={() => onAdd(song.id)}
          className="h-6 gap-1 px-2 text-[10px]"
          title="Add to queue"
        >
          <PlusIcon className="size-2.5" />
          RTQ
        </Button>
      </div>
    </li>
  )
}
