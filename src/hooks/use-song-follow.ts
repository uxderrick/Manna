import { useEffect, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useTauriEvent } from "@/hooks/use-tauri-event"
import { songStanzaToRenderData } from "@/lib/song-to-render"
import { activeSongId, shouldMove, slideFor, type SongPosition } from "@/lib/song-follow"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"
import { useSongMatchStore } from "@/stores/song-match-store"
import { useSongStore } from "@/stores/song-store"

/** After the operator changes slides by hand, following waits this long. */
const MANUAL_PAUSE_MS = 8_000

/** Queue index the follower itself last showed (so it is not taken for the operator's). */
let followerIndex: number | null = null

/** Show a song's queue slide live, as clicking it in the queue does. */
export function presentSongSlide(index: number): void {
  const item = useQueueStore.getState().items[index]
  if (item?.kind !== "song-stanza") return
  followerIndex = index
  useQueueStore.getState().setActive(index)
  const render = songStanzaToRenderData(item, useSongStore.getState().getSong(item.songId))
  if (!render) return
  useBroadcastStore.getState().setPreviewVerse(render)
  useBroadcastStore.getState().goLive()
}

/**
 * Follows the song on screen as it is sung: tells song detection which song
 * is live, and on each sung position moves the slides (auto), offers the
 * next slide (suggest), or does nothing (off). Mount once, in songs mode.
 */
export function useSongFollow(): void {
  const isLive = useBroadcastStore((s) => s.isLive)
  const liveSong = useQueueStore((s) => activeSongId(s.items, s.activeIndex))
  const followed = isLive ? liveSong : null

  useEffect(() => {
    useSongMatchStore.getState().setSuggestion(null)
    useSongMatchStore.getState().setPosition(null)
    invoke("set_followed_song", { songId: followed }).catch(() => {})
  }, [followed])
  // Leaving songs mode (unmount): stop following.
  useEffect(() => () => void invoke("set_followed_song", { songId: null }).catch(() => {}), [])

  const manualAt = useRef(0)
  const previousTarget = useRef<number | null>(null)
  useEffect(
    () =>
      useQueueStore.subscribe((state, prev) => {
        if (state.activeIndex === prev.activeIndex) return
        if (state.activeIndex !== followerIndex) manualAt.current = Date.now()
        useSongMatchStore.getState().setSuggestion(null)
      }),
    [],
  )

  useTauriEvent<SongPosition>("song_position", (position) => {
    const matches = useSongMatchStore.getState()
    const { items, activeIndex } = useQueueStore.getState()
    if (activeIndex === null || activeSongId(items, activeIndex) !== position.songId) return
    matches.setPosition(position)
    if (!position.confident || matches.follow === "off") return
    const song = useSongStore.getState().getSong(position.songId)
    if (!song) return
    const target = slideFor(items, activeIndex, song, position)
    if (target === null) return
    const move = shouldMove(target, activeIndex, previousTarget.current)
    previousTarget.current = target
    if (!move) return
    if (matches.follow === "suggest") {
      matches.setSuggestion(target)
      return
    }
    if (Date.now() - manualAt.current < MANUAL_PAUSE_MS) return
    presentSongSlide(target)
  })
}
