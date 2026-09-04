import { describe, expect, it } from "vitest"
import {
  buildSessionExportJson,
  buildSessionExportMarkdown,
  buildSessionExportSlug,
  buildSessionPdfBytes,
  buildSessionPrintHtml,
} from "./session-export"
import type { SessionDetection, SessionNote, SessionTranscriptSegment } from "@/types/session"

const detections: SessionDetection[] = [
  {
    id: 1,
    sessionId: 42,
    verseRef: "John 3:16",
    verseText: "For God so loved the world",
    translation: "KJV",
    confidence: 0.91,
    source: "semantic",
    detectedAt: "2026-06-14T09:30:00Z",
    wasPresented: true,
    transcriptSnippet: "God loved the world",
  },
]

const notes: SessionNote[] = [
  {
    id: 2,
    sessionId: 42,
    content: "Main altar call",
    noteType: "manual",
    createdAt: "2026-06-14T09:31:00Z",
  },
]

const transcript: SessionTranscriptSegment[] = [
  {
    id: 3,
    sessionId: 42,
    text: "This is the transcript.",
    isFinal: true,
    confidence: 0.98,
    timestampMs: 1000,
    speakerLabel: null,
  },
]

describe("session export helpers", () => {
  it("builds a stable filename slug from a session title", () => {
    expect(buildSessionExportSlug("Sunday Service: Grace & Truth!")).toBe("sunday-service-grace-truth")
    expect(buildSessionExportSlug("!!!")).toBe("session")
  })

  it("builds markdown and json exports with session content", () => {
    const markdown = buildSessionExportMarkdown("Sunday Service", detections, notes, transcript)
    expect(markdown).toContain("# Sunday Service")
    expect(markdown).toContain("John 3:16")
    expect(markdown).toContain("Main altar call")
    expect(markdown).toContain("This is the transcript.")

    expect(buildSessionExportJson("Sunday Service", 42, detections, notes, transcript)).toEqual({
      title: "Sunday Service",
      sessionId: 42,
      detections,
      notes,
      transcript,
    })
  })

  it("builds a printable html document from export content", () => {
    const html = buildSessionPrintHtml("Sunday <Service>", detections, notes, transcript)
    expect(html).toContain("<!doctype html>")
    expect(html).toContain("Sunday &lt;Service&gt;")
    expect(html).toContain("John 3:16")
    expect(html).toContain("This is the transcript.")
    expect(html).not.toContain("<Service>")
  })

  it("builds a valid pdf file from session content", () => {
    const bytes = buildSessionPdfBytes("Sunday Service", detections, notes, transcript)
    const pdf = new TextDecoder().decode(bytes)

    expect(pdf.startsWith("%PDF-1.4")).toBe(true)
    expect(pdf).toContain("/Type /Catalog")
    expect(pdf).toContain("Sunday Service")
    expect(pdf).toContain("John 3:16")
    expect(pdf).toContain("%%EOF")
  })
})
