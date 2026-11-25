import { invoke } from "@tauri-apps/api/core"
import { open } from "@tauri-apps/plugin-dialog"
import { toast } from "sonner"
import { MusicIcon, PlayIcon, PlusIcon, RadioIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfidenceDot } from "@/components/ui/confidence-dot"
import { useTauriEvent } from "@/hooks/use-tauri-event"
import { presentSongSlide, useSongFollow } from "@/hooks/use-song-follow"
import { expandSong } from "@/lib/song-expand"
import { activeSongId, positionStanzas, slideFor, stanzaLabel, type FollowMode } from "@/lib/song-follow"
import { useBroadcastStore } from "@/stores/broadcast-store"
import type { QueueItem, Song } from "@/types"
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
    presentSongLive(song.id, startSlide(song, match))
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

/** The slide of `song` the match points at (its stanza and line), from the song's start. */
function startSlide(song: Song, match: MergedSongMatch): number {
  if (match.stanza === null) return 0
  const stanza = positionStanzas(song)[match.stanza]
  if (!stanza) return 0
  const line = Math.max(0, stanza.lines.indexOf(match.line ?? ""))
  // The song's slides as presenting it will queue them.
  const slides = expandSong(song).map(
    (e, i) => ({ kind: "song-stanza", id: String(i), songId: song.id, stanzaId: e.stanzaRefId, expandedIndex: i }) as QueueItem,
  )
  return slideFor(slides, 0, song, { stanza: match.stanza, line }, false) ?? 0
}

const FOLLOW_MODES: Array<{ mode: FollowMode; label: string; title: string }> = [
  { mode: "auto", label: "Auto", title: "Move the slides as the song is sung" },
  { mode: "suggest", label: "Suggest", title: "Offer the next slide; you press to show it" },
  { mode: "off", label: "Off", title: "Do not follow the singing" },
]

/** The song on screen, where the singing is in it, and how slides follow it. */
function FollowBar() {
  const isLive = useBroadcastStore((s) => s.isLive)
  const songId = useQueueStore((s) => activeSongId(s.items, s.activeIndex))
  const song = useSongStore((s) => (songId ? s.songs.find((x) => x.id === songId) : undefined))
  const follow = useSongMatchStore((s) => s.follow)
  const position = useSongMatchStore((s) => s.position)
  const suggestion = useSongMatchStore((s) => s.suggestion)
  const suggested = useQueueStore((s) => (suggestion === null ? undefined : s.items[suggestion]))
  if (!isLive || !song) return null
  const sung = position?.songId === song.id ? positionStanzas(song)[position.stanza] : undefined
  return (
    <div className="flex flex-col gap-1.5 border-b border-border bg-primary/5 px-3 py-2 text-[0.625rem]">
      <div className="flex items-center gap-2">
        <RadioIcon className="size-3 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate">
          Following <span className="font-medium text-foreground">{song.title}</span>
          {sung && <> · singing {stanzaLabel(song, sung.id)}</>}
        </span>
        <div className="flex shrink-0 rounded-full border border-border p-0.5" role="radiogroup" aria-label="Follow the singing">
          {FOLLOW_MODES.map(({ mode, label, title }) => (
            <button
              key={mode}
              role="radio"
              aria-checked={follow === mode}
              title={title}
              onClick={() => useSongMatchStore.getState().setFollow(mode)}
              className={`rounded-full px-1.5 py-0.5 font-medium transition-colors ${follow === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {follow === "suggest" && suggestion !== null && suggested?.kind === "song-stanza" && (
        <Button
          size="xs"
          className="gap-1 self-start rounded-full px-2.5 text-[10px]"
          onClick={() => {
            presentSongSlide(suggestion)
            useSongMatchStore.getState().setSuggestion(null)
          }}
        >
          <PlayIcon className="size-2.5" />
          Show {stanzaLabel(song, suggested.stanzaId)}
        </Button>
      )}
    </div>
  )
}

interface PackImportReport {
  matched: Array<{ title: string; songTitle: string; recordings: number }>
  unmatched: string[]
  soundSongs: number
}

/** Pick a song pack (made with manna-songpack) and attach its recordings to the songs. */
async function importSongPack() {
  const path = await open({ multiple: false, filters: [{ name: "Song pack", extensions: ["mannasongs"] }] })
  if (typeof path !== "string") return
  try {
    const report = await invoke<PackImportReport>("import_song_pack", { path })
    const store = useSongMatchStore.getState()
    if (store.status) store.setStatus({ ...store.status, soundSongs: report.soundSongs })
    const recordings = report.matched.reduce((n, m) => n + m.recordings, 0)
    const missing = report.unmatched.length
    toast.success(`Song pack: ${report.matched.length} songs recognised by sound (${recordings} recordings)`, {
      description: missing
        ? `${missing} not in your library: ${report.unmatched.slice(0, 5).join(", ")}${missing > 5 ? "…" : ""}. Add them, then import again.`
        : undefined,
    })
  } catch (error) {
    toast.error("Could not import the song pack", { description: String(error) })
  }
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
      {" · "}
      <button
        className="underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground"
        title="Add recordings of whole songs (a .mannasongs file made with manna-songpack) so they are recognised by sound"
        onClick={() => void importSongPack()}
      >
        Import song pack
      </button>
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
  // No singing for a while: the backend has started fresh for the next
  // song. The song on screen stays current.
  useTauriEvent<null>("song_matches_idle", () => {
    const { items, activeIndex } = useQueueStore.getState()
    const live = useBroadcastStore.getState().isLive ? activeSongId(items, activeIndex) : null
    useSongMatchStore.getState().putAside(live)
  })
  useSongFollow()
  const matches = mergeSongMatches(bySource)
  const current = new Set(matches.map((m) => m.songId))
  const earlier = earlierAll.filter((m) => !current.has(m.songId))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <StatusLine />
      <FollowBar />
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
