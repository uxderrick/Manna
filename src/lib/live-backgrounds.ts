import type { BroadcastTheme, VerseRenderData } from "@/types"

export type BackgroundContext = "scripture" | "song"
export interface BackgroundChoice {
  id: string | null
  dimming: number
}
export type BackgroundChoices = Record<BackgroundContext, BackgroundChoice>

export const BACKGROUND_MEDIA = [
  ...["Aurora", "Bokeh", "Nebula", "Rays", "Starfield"].flatMap((design) =>
    ["Cool", "Warm"].map((color) => {
      const id = `${design}-${color}`.toLowerCase()
      return {
        id,
        name: `${design} ${color}`,
        kind: "video" as const,
        url: `/backgrounds/worship/${id}.mp4`,
        thumbnail: `/backgrounds/worship/${id}.jpg`,
      }
    })
  ),
  ...[
    ["window-light", "Window Light"],
    ["hearth", "Hearth"],
    ["candlelight", "Candlelight"],
  ].map(([id, name]) => ({
    id,
    name,
    kind: "video" as const,
    url: `/backgrounds/worship/${id}.mp4`,
    thumbnail: `/backgrounds/worship/${id}.jpg`,
  })),
  ...[
    ["the-word", "The Word", "png"],
    ["quiet-light", "Quiet Light", "png"],
    ["still-waters", "Still Waters", "png"],
    ["night-sky", "Night Sky", "jpg"],
    ["refractions-rush", "Refractions Rush", "jpg"],
  ].map(([id, name, extension]) => ({
    id,
    name,
    kind: "image" as const,
    url: `/backgrounds/${id}.${extension}`,
    thumbnail: `/backgrounds/${id}.${extension}`,
  })),
]

export function backgroundContext(
  verse: VerseRenderData | null
): BackgroundContext {
  return verse?.hideReference ? "song" : "scripture"
}

export function withLiveBackground(
  theme: BroadcastTheme,
  choice: BackgroundChoice
): BroadcastTheme {
  const media = BACKGROUND_MEDIA.find((item) => item.id === choice.id)
  if (!media) return theme
  const dimming = Math.max(0, Math.min(0.8, choice.dimming))
  return {
    ...theme,
    background: {
      ...theme.background,
      type: media.kind,
      video:
        media.kind === "video"
          ? { url: media.url, dimming, poster: media.thumbnail }
          : null,
      image:
        media.kind === "image"
          ? {
              url: media.url,
              fit: "cover",
              blur: 0,
              brightness: 100,
              tint: `rgba(0, 0, 0, ${dimming})`,
            }
          : theme.background.image,
    },
  }
}

const STORAGE_KEY = "manna-live-backgrounds"

export function loadBackgroundChoices(): BackgroundChoices {
  const choices: BackgroundChoices = {
    scripture: { id: null, dimming: 0.25 },
    song: { id: null, dimming: 0.25 },
  }
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")
    for (const context of ["scripture", "song"] as const) {
      const choice = saved?.[context]
      if (
        choice &&
        (choice.id === null ||
          BACKGROUND_MEDIA.some((item) => item.id === choice.id)) &&
        Number.isFinite(choice.dimming) &&
        choice.dimming >= 0 &&
        choice.dimming <= 0.8
      ) {
        choices[context] = { id: choice.id, dimming: choice.dimming }
      }
    }
  } catch {
    /* Storage can be unavailable or contain an older value. */
  }
  return choices
}

export function saveBackgroundChoices(choices: BackgroundChoices): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(choices))
  } catch {
    /* Live selection still works when storage is unavailable. */
  }
}
