export type SessionStatus = "planned" | "live" | "completed"

export interface PlannedScripture {
  verseRef: string
  translation: string
  order: number
}

export interface SermonSession {
  id: number
  title: string
  speaker: string | null
  date: string
  seriesName: string | null
  tags: string[]
  startedAt: string | null
  endedAt: string | null
  status: SessionStatus
  plannedScriptures: PlannedScripture[]
  summary: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateSessionRequest {
  title: string
  speaker?: string
  date: string
  seriesName?: string
  tags?: string[]
  plannedScriptures?: PlannedScripture[]
}

export interface SessionDetection {
  id: number
  sessionId: number
  verseRef: string
  verseText: string
  translation: string
  confidence: number
  source: string
  detectedAt: string
  wasPresented: boolean
  transcriptSnippet: string | null
}

export interface SessionTranscriptSegment {
  id: number
  sessionId: number
  text: string
  isFinal: boolean
  confidence: number | null
  timestampMs: number
  speakerLabel: string | null
}

export interface SessionNote {
  id: number
  sessionId: number
  noteType: string
  content: string
  createdAt: string
}
