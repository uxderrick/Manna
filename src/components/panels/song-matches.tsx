import { invoke } from "@tauri-apps/api/core"
import { MusicIcon, PlayIcon, PlusIcon, RadioIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfidenceDot } from "@/components/ui/confidence-dot"
import { useTauriEvent } from "@/hooks/use-tauri-event"
import { useQueueStore, useSongStore, useTranscriptStore } from "@/stores"
import {
  mergeSongMatches,
  useSongMatchStore,
  type MergedSongMatch,
  type SongMatchesPayload,
  type SongMatchSource,
} from "@/stores/song-match-store"

const SOURCE_STYLE: Record<SongMatchSource, { className: string; label: string; title: string }> = {
  lyrics: { className: "bg-blue-500/15 text-blue-600", label: "Lyrics", title: "Matched from the words being sung" },
  sound: { className: "bg-amber-500/15 text-amber-600", label: "Sound", title: "Matched from the music itself" },
}

function SongMatchCard({ match, earlier = false }: { match: MergedSongMatch; earlier?: boolean }) {
  const song = useSongStore((s) => s.songs.find((x) => x.id === match.songId))
  const presentSongLive = useQueueStore((s) => s.presentSongLive)
  const enqueueSong = useQueueStore((s) => s.enqueueSong)
  const soundOn = useSongMatchStore((s) => s.status?.sound ?? false)
  if (!song) return null

  const goLive = () => {
    presentSongLive(song.id)
    // The operator confirmed it: learn from what was just heard so this
    // song is recognised sooner next time.
    if (soundOn) void invoke("confirm_detected_song", { songId: song.id }).catch(() => {})
  }

  return (
    <div className="p-1.5">
      <div
        onDoubleClick={goLive}
        title="Double-click to go live"
        className={`select-none rounded-xl border p-3 transition-colors hover:border-primary/40 ${earlier ? "border-border bg-surface-elevated opacity-60 hover:opacity-100" : match.confident ? "border-primary/50 bg-primary/5" : "border-border bg-surface-elevated"}`}
      >
        <div className="flex items-center gap-2">
          <ConfidenceDot confidence={match.confident ? 0.95 : Math.min(0.79, 0.4 + match.score)} />
          {match.sources.map((source) => (
            <span
              key={source}
              title={SOURCE_STYLE[source].title}
              className={`rounded px-1.5 py-0.5 text-[0.5625rem] font-medium uppercase tracking-wider ${SOURCE_STYLE[source].className}`}
            >
              {SOURCE_STYLE[source].label}
            </span>
          ))}
          <span className="min-w-0 truncate text-sm font-semibold text-foreground">{song.title}</span>
          <span className="text-[0.625rem] tabular-nums text-muted-foreground">{Math.round(match.score * 100)}%</span>
          {match.confident && !earlier && (
            <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[0.5625rem] font-semibold uppercase tracking-wider text-primary-foreground">
              Likely
            </span>
          )}
        </div>
        {match.line && (
          <p className="mt-1 line-clamp-2 font-serif text-sm leading-relaxed text-muted-foreground">{match.line}</p>
        )}
        <div className="mt-2 flex gap-1.5">
          <Button
            size="xs"
            className="gap-1 rounded-full px-2.5 text-[10px]"
            onClick={(e) => {
              e.stopPropagation()
              goLive()
            }}
          >
            <PlayIcon className="size-2.5" />
            Go Live
          </Button>
          <Button
            variant="outline"
            size="xs"
            className="gap-1 rounded-full px-2.5 text-[10px]"
            onClick={(e) => {
              e.stopPropagation()
              enqueueSong(song.id)
            }}
          >
            <PlusIcon className="size-2.5" />
            Add to Queue
          </Button>
        </div>
      </div>
    </div>
  )
}

function StatusLine() {
  const status = useSongMatchStore((s) => s.status)
  if (!status) return null
  return (
    <div className="border-b border-border px-3 py-1.5 text-[0.625rem] leading-relaxed text-muted-foreground">
      <span className="font-medium text-foreground">{status.lyricsSongs}</span> songs by lyrics
      {" · "}
      {status.sound ? (
        <>
          sound on (<span className="font-medium text-foreground">{status.soundSongs}</span> recorded)
        </>
      ) : (
        <span title={status.soundNote ?? undefined}>sound off</span>
      )}
      {" · "}
      {status.gate ? (
        <span title="Only singing and music are transcribed; talk is left out">singing only</span>
      ) : (
        <span title={status.gateNote ?? undefined}>all audio</span>
      )}
    </div>
  )
}

/** The detections panel's songs view: best matches from lyrics and sound. */
export function SongMatches() {
  const bySource = useSongMatchStore((s) => s.bySource)
  const earlierAll = useSongMatchStore((s) => s.earlier)
  const isTranscribing = useTranscriptStore((s) => s.isTranscribing)
  useTauriEvent<SongMatchesPayload>("song_matches", (payload) => {
    useSongMatchStore.getState().receive(payload)
  })
  // No singing for a while: the backend has started fresh for the next song.
  useTauriEvent<null>("song_matches_idle", () => {
    useSongMatchStore.getState().putAside()
  })
  const matches = mergeSongMatches(bySource)
  const current = new Set(matches.map((m) => m.songId))
  const earlier = earlierAll.filter((m) => !current.has(m.songId))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <StatusLine />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {matches.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
              <MusicIcon className={`size-5 text-primary ${isTranscribing ? "animate-pulse" : ""}`} />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-foreground">
                {isTranscribing ? "Listening for songs" : "Start the service to listen for songs"}
              </p>
              <p className="text-[0.625rem] leading-relaxed text-muted-foreground">
                Songs appear here as they are sung. Lyrics work for every song in your library; songs with a
                recording are also recognised by their music.
              </p>
            </div>
          </div>
        )}
        {matches.map((m) => (
          <SongMatchCard key={m.songId} match={m} />
        ))}
        {earlier.length > 0 && (
          <>
            <p className="px-3 pt-3 text-[0.625rem] font-medium uppercase tracking-wider text-muted-foreground">Earlier</p>
            {earlier.map((m) => (
              <SongMatchCard key={`earlier-${m.songId}`} match={m} earlier />
            ))}
          </>
        )}
      </div>
      {matches.some((m) => m.confident) && (
        <div className="flex items-center gap-1.5 border-t border-border px-3 py-1.5 text-[0.625rem] text-muted-foreground">
          <RadioIcon className="size-3" />
          "Likely" songs are not shown on screen until you press Go Live.
        </div>
      )}
    </div>
  )
}
