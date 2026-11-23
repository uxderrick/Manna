import type { YouTubeLink } from "@/lib/youtube"
import { BACKGROUND_MEDIA } from "@/lib/live-backgrounds"

export type Tab = "local" | "online"
export type Provider =
  | "pexels"
  | "unsplash"
  | "brave"
  | "local"
  | "library"
  | "youtube"

export interface MediaHit {
  id: string
  mediaType?: "video" | "youtube"
  url: string
  thumbnailUrl: string
  label: string
  provider: Provider
  photographer: string | null
  photographerUrl: string | null
  width: number
  height: number
  /** Raw filesystem path for local images; used when deleting. */
  localPath?: string
  /**
   * Containing folder used as the validation root for `validate_local_image`.
   * For folder-browse hits this equals `localImageFolder`. For single-file
   * picks via the OS dialog it's the parent directory of the picked file —
   * the user already consented via the dialog, so the file's own parent is
   * the natural validation root.
   */
  validationFolder?: string
}

export type OnlineFilter = "all" | "pexels" | "unsplash" | "brave"

export function isVideoPath(path: string): boolean {
  return /\.(mp4|m4v|mov|webm)$/i.test(path)
}

export const BUILTIN_LOOPS: MediaHit[] = BACKGROUND_MEDIA.filter(
  (media) => media.kind === "video"
).map((media) => ({
  id: `loop-${media.id}`,
  url: media.url,
  thumbnailUrl: media.thumbnail,
  label: media.name,
  provider: "library",
  mediaType: "video",
  photographer: null,
  photographerUrl: null,
  width: 1920,
  height: 1080,
}))

export function youtubeMedia(link: YouTubeLink): MediaHit {
  return {
    id: `youtube-${link.videoId}`,
    mediaType: "youtube",
    url: link.url,
    thumbnailUrl: link.poster,
    label: link.label,
    provider: "youtube",
    photographer: null,
    photographerUrl: null,
    width: 1920,
    height: 1080,
  }
}
