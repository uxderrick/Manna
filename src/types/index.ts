export type {
  DeviceInfo,
  AudioLevel,
  AudioConfig,
  AudioTestDevice,
  AudioTestMeter,
  AudioTestWaveform,
  AudioTestStopped,
} from "./audio"
export type {
  Word,
  TranscriptSegment,
  TranscriptEventPayload,
} from "./transcript"
export type { Translation, Book, Verse, CrossReference } from "./bible"
export type { QueueItem } from "./queue"
export type { Song, SongStanza, SongSource, LineMode, GeniusHit, LrclibHit, OnlineHit, HymnalSource } from "./song"
export { GHS_SEED_VERSION, HYMNAL_SOURCES, HYMNAL_NAMES, HYMNAL_BADGES, isHymnalSource } from "./song"
export type { DetectionResult, DetectionStatus } from "./detection"
export type { BroadcastTheme, VerseRenderData, VerseSegment, RenderOptions, NotesSlide, TextHighlight, WordHitBox } from "./broadcast"
export type {
  NdiAlphaMode,
  NdiConfigEventPayload,
  NdiFrameRate,
  NdiFrameRequest,
  NdiResolution,
  NdiSessionInfo,
  NdiStartRequest,
} from "./ndi"
export type {
  SessionStatus, PlannedScripture, SermonSession, CreateSessionRequest,
  SessionDetection, SessionTranscriptSegment, SessionNote,
} from "./session"

/* ------------------------- Service Plan ------------------------- */

export type PlanKind = "template" | "session"

export type PlanItemType = "verse" | "song" | "announcement" | "section" | "blank" | "momo" | "jesus" | "notes"

export interface TemplateMeta {
  id: number
  name: string
  notes: string | null
  createdAt: number
  updatedAt: number
  itemCount: number
}

export interface PlanItemVerse {
  type: "verse"
  verseRef: string
  translationId: number
  verseText: string
  bookNumber: number
  chapter: number
  verse: number
  bookName: string
}

export interface PlanItemSong {
  type: "song"
  songId: string
  autoChorus: boolean
  lineMode: string
}

export interface PlanItemAnnouncement {
  type: "announcement"
  title: string
  body: string
  themeId?: string
  /** Display mode on broadcast. Defaults to "slide" when missing. */
  mode?: "ticker" | "slide"
  /** Auto-dismiss after N seconds. `null` = manual dismiss. Default null. */
  duration?: number | null
}

export interface PlanItemSection {
  type: "section"
  label: string
}

export interface PlanItemBlank {
  type: "blank"
  showLogo: boolean
  imageUrl?: string
  imageLabel?: string
}

export interface PlanItemMomo {
  type: "momo"
}

export interface PlanItemJesus {
  type: "jesus"
}

export interface PlanItemNotes {
  type: "notes"
  /** Optional slide header. Empty string treated as "no header". */
  title: string
  /** Ordered session-note IDs from prior open. Used as defaults next time the drawer mounts. */
  lastSelection: number[]
}

export type PlanItemPayload =
  | PlanItemVerse
  | PlanItemSong
  | PlanItemAnnouncement
  | PlanItemSection
  | PlanItemBlank
  | PlanItemMomo
  | PlanItemJesus
  | PlanItemNotes

export interface PlanItem {
  id: number
  planId: number
  planKind: PlanKind
  orderIndex: number
  itemType: PlanItemType
  /** JSON-encoded `PlanItemPayload`. Use `parsePlanItem()` to decode. */
  itemData: string
  autoAdvanceSeconds: number | null
}

export interface Plan {
  planId: number
  planKind: PlanKind
  items: PlanItem[]
}

/**
 * Parse a PlanItem's JSON payload into a typed PlanItemPayload. Returns null
 * for corrupted data; callers should render a placeholder blank instead of
 * crashing.
 */
export function parsePlanItem(item: PlanItem): PlanItemPayload | null {
  try {
    const parsed = JSON.parse(item.itemData) as Record<string, unknown>
    const type = item.itemType
    if (type === "verse" && typeof parsed.verseRef === "string") {
      return { type: "verse", ...(parsed as Omit<PlanItemVerse, "type">) }
    }
    if (type === "song" && typeof parsed.songId === "string") {
      return { type: "song", ...(parsed as Omit<PlanItemSong, "type">) }
    }
    if (type === "announcement" && typeof parsed.title === "string") {
      return { type: "announcement", ...(parsed as Omit<PlanItemAnnouncement, "type">) }
    }
    if (type === "section" && typeof parsed.label === "string") {
      return { type: "section", label: parsed.label }
    }
    if (type === "blank") {
      return {
        type: "blank",
        showLogo: Boolean(parsed.showLogo),
        imageUrl: typeof parsed.imageUrl === "string" ? parsed.imageUrl : undefined,
        imageLabel: typeof parsed.imageLabel === "string" ? parsed.imageLabel : undefined,
      }
    }
    if (type === "momo") {
      return { type: "momo" }
    }
    if (type === "jesus") {
      return { type: "jesus" }
    }
    if (type === "notes") {
      return {
        type: "notes",
        title: typeof parsed.title === "string" ? parsed.title : "",
        lastSelection: Array.isArray(parsed.lastSelection)
          ? (parsed.lastSelection as unknown[]).filter((n): n is number => typeof n === "number")
          : [],
      }
    }
    return null
  } catch {
    return null
  }
}
