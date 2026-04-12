import { invoke } from "@tauri-apps/api/core"
import type {
  SermonSession,
  CreateSessionRequest,
  SessionDetection,
  SessionTranscriptSegment,
  SessionNote,
} from "@/types/session"

export function useSession() {
  return {
    createSession: (request: CreateSessionRequest) =>
      invoke<SermonSession>("create_session", { request }),
    getSession: (id: number) =>
      invoke<SermonSession>("get_session", { id }),
    listSessions: () =>
      invoke<SermonSession[]>("list_sessions"),
    startSession: (id: number) =>
      invoke<SermonSession>("start_session", { id }),
    endSession: (id: number) =>
      invoke<SermonSession>("end_session", { id }),
    deleteSession: (id: number) =>
      invoke<void>("delete_session", { id }),
    updateSummary: (id: number, summary: string) =>
      invoke<void>("update_session_summary", { id, summary }),
    addDetection: (request: {
      sessionId: number; verseRef: string; verseText: string;
      translation: string; confidence: number; source: string;
      transcriptSnippet?: string;
    }) => invoke<SessionDetection>("add_session_detection", { request }),
    getDetections: (sessionId: number) =>
      invoke<SessionDetection[]>("get_session_detections", { sessionId }),
    addTranscript: (request: {
      sessionId: number; text: string; isFinal: boolean;
      confidence?: number; timestampMs: number; speakerLabel?: string;
    }) => invoke<void>("add_session_transcript", { request }),
    getTranscript: (sessionId: number) =>
      invoke<SessionTranscriptSegment[]>("get_session_transcript", { sessionId }),
    addNote: (request: { sessionId: number; noteType: string; content: string }) =>
      invoke<SessionNote>("add_session_note", { request }),
    getNotes: (sessionId: number) =>
      invoke<SessionNote[]>("get_session_notes", { sessionId }),
  }
}
