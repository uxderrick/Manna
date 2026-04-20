import { useEffect } from "react"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from "@/components/ui/drawer"
import { Button } from "@/components/ui/button"
import { useSongStore, useQueueStore } from "@/stores"
import type { LineMode, SongStanza } from "@/types"

const LINE_MODES: { value: LineMode; label: string }[] = [
  { value: "line", label: "Line" },
  { value: "stanza-pair", label: "Pair" },
  { value: "stanza-full", label: "Full" },
]

export function SongDetailDrawer({
  songId,
  onClose,
}: {
  songId: string | null
  onClose: () => void
}) {
  const song = useSongStore((s) =>
    songId ? s.songs.find((x) => x.id === songId) : undefined,
  )
  const setAutoChorus = useSongStore((s) => s.setAutoChorus)
  const setLineMode = useSongStore((s) => s.setLineMode)
  const deleteSong = useSongStore((s) => s.deleteSong)

  const enqueueSong = useQueueStore((s) => s.enqueueSong)
  const enqueueSongStanza = useQueueStore((s) => s.enqueueSongStanza)
  const presentSongLive = useQueueStore((s) => s.presentSongLive)

  // If a drawer is open with a songId that no longer resolves (deleted
  // mid-interaction by another client/sync), close ourselves.
  useEffect(() => {
    if (songId && !song) onClose()
  }, [songId, song, onClose])

  if (songId === null) return null
  if (!song) return null

  const canDelete = song.source !== "ghs"

  async function handleDelete() {
    if (!song) return
    await deleteSong(song.id)
    onClose()
  }

  function renderStanza(
    stanza: SongStanza,
    label: string,
    isChorus: boolean,
  ) {
    return (
      <div
        key={`${stanza.id}-${label}`}
        className={
          isChorus
            ? "rounded-md border border-primary/30 bg-primary/5 p-3"
            : "rounded-md border border-border bg-background p-3"
        }
      >
        <div className="mb-2 flex items-center justify-between">
          <span
            className={
              isChorus
                ? "text-xs font-semibold uppercase tracking-wide text-primary"
                : "text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            }
          >
            {label}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Add ${label} to queue`}
            onClick={() => enqueueSongStanza(song!.id, stanza.id)}
          >
            +
          </Button>
        </div>
        <div className="space-y-0.5 text-sm leading-relaxed">
          {stanza.lines.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <Drawer open={!!songId} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="mx-auto max-h-[55vh] max-w-2xl">
        <DrawerHeader>
          <DrawerTitle>
            {song.number !== null ? `${song.number}. ` : ""}
            {song.title}
          </DrawerTitle>
          {song.author ? (
            <DrawerDescription>{song.author}</DrawerDescription>
          ) : null}
        </DrawerHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-2">
          {/* Settings */}
          <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
            <div className="space-y-2">
              <span className="text-xs font-medium text-muted-foreground">
                Line mode
              </span>
              <div className="flex gap-1">
                {LINE_MODES.map((opt) => (
                  <Button
                    key={opt.value}
                    size="sm"
                    variant={
                      song.lineMode === opt.value ? "default" : "outline"
                    }
                    onClick={() => setLineMode(song.id, opt.value)}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={song.autoChorus}
                onChange={(e) => setAutoChorus(song.id, e.target.checked)}
                className="rounded"
                disabled={!song.chorus}
              />
              <span className="font-medium">Auto-insert chorus</span>
              {!song.chorus ? (
                <span className="text-xs text-muted-foreground">
                  (no chorus)
                </span>
              ) : null}
            </label>
          </div>

          {/* Stanzas */}
          <div className="space-y-2">
            {song.stanzas.map((stanza, idx) =>
              renderStanza(stanza, `V${idx + 1}`, false),
            )}
            {song.chorus
              ? renderStanza(song.chorus, "CH", true)
              : null}
          </div>
        </div>

        <DrawerFooter>
          <div className="flex gap-2">
            <Button
              variant="default"
              className="flex-1"
              onClick={() => {
                presentSongLive(song.id)
                onClose()
              }}
            >
              Go Live
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                enqueueSong(song.id)
                onClose()
              }}
            >
              Add to queue
            </Button>
          </div>
          {canDelete ? (
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          ) : null}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
