import type { SessionDetection, SessionNote, SessionTranscriptSegment } from "@/types/session"

export interface SessionExportJson {
  title: string
  sessionId: number
  detections: SessionDetection[]
  notes: SessionNote[]
  transcript: SessionTranscriptSegment[]
}

export function formatSessionExportTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

export function buildSessionExportSlug(title: string) {
  return title
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "session"
}

export function buildSessionExportMarkdown(
  title: string,
  detections: SessionDetection[],
  notes: SessionNote[],
  transcript: SessionTranscriptSegment[],
) {
  const lines: string[] = [`# ${title}`, ""]

  if (detections.length > 0) {
    lines.push("## Verses Detected", "")
    detections.forEach((d, i) => {
      const pct = Math.round(d.confidence * 100)
      const shown = d.wasPresented ? " - Shown on screen" : ""
      lines.push(`${i + 1}. ${d.verseRef} (${pct}%)${shown}`)
      if (d.verseText) lines.push(`   "${d.verseText}"`)
    })
    lines.push("")
  }

  if (notes.length > 0) {
    lines.push("## Notes", "")
    notes.forEach((n) => {
      lines.push(`- "${n.content}" (${formatSessionExportTime(n.createdAt)})`)
    })
    lines.push("")
  }

  if (transcript.length > 0) {
    lines.push("## Transcript", "")
    lines.push(transcript.map((s) => s.text).join(" "))
    lines.push("")
  }

  return lines.join("\n")
}

export function buildSessionExportJson(
  title: string,
  sessionId: number,
  detections: SessionDetection[],
  notes: SessionNote[],
  transcript: SessionTranscriptSegment[],
): SessionExportJson {
  return { title, sessionId, detections, notes, transcript }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function nl2br(value: string) {
  return escapeHtml(value).replace(/\n/g, "<br />")
}

export function buildSessionPrintHtml(
  title: string,
  detections: SessionDetection[],
  notes: SessionNote[],
  transcript: SessionTranscriptSegment[],
) {
  const verses = detections
    .map((d, i) => {
      const pct = Math.round(d.confidence * 100)
      const shown = d.wasPresented ? " <span>Shown on screen</span>" : ""
      const text = d.verseText ? `<blockquote>${nl2br(d.verseText)}</blockquote>` : ""
      return `<li><strong>${i + 1}. ${escapeHtml(d.verseRef)}</strong> (${pct}%)${shown}${text}</li>`
    })
    .join("")

  const noteItems = notes
    .map((n) => `<li>${nl2br(n.content)} <time>${escapeHtml(formatSessionExportTime(n.createdAt))}</time></li>`)
    .join("")

  const transcriptText = transcript.map((s) => s.text).join(" ")

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { color: #111; font: 14px/1.55 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 40px; }
    h1 { font-size: 28px; margin: 0 0 24px; }
    h2 { border-bottom: 1px solid #ddd; font-size: 16px; margin: 28px 0 12px; padding-bottom: 6px; text-transform: uppercase; }
    ol, ul { padding-left: 22px; }
    li { margin: 0 0 10px; }
    blockquote { border-left: 3px solid #ccc; color: #333; margin: 8px 0 0; padding-left: 12px; }
    time, span { color: #666; font-size: 12px; }
    @media print { body { margin: 24mm; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${detections.length ? `<section><h2>Verses Detected</h2><ol>${verses}</ol></section>` : ""}
  ${notes.length ? `<section><h2>Notes</h2><ul>${noteItems}</ul></section>` : ""}
  ${transcript.length ? `<section><h2>Transcript</h2><p>${nl2br(transcriptText)}</p></section>` : ""}
</body>
</html>`
}

function escapePdfText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")
}

function normalizePdfText(value: string) {
  return value.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "")
}

function wrapPdfLine(value: string, maxChars = 86) {
  const words = normalizePdfText(value).split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ""

  for (const word of words) {
    if (!line) {
      line = word
    } else if (`${line} ${word}`.length <= maxChars) {
      line = `${line} ${word}`
    } else {
      lines.push(line)
      line = word
    }
  }

  if (line) lines.push(line)
  return lines.length > 0 ? lines : [""]
}

function buildPdfLines(
  title: string,
  detections: SessionDetection[],
  notes: SessionNote[],
  transcript: SessionTranscriptSegment[],
) {
  const lines: string[] = [title, ""]

  if (detections.length > 0) {
    lines.push("Verses Detected")
    detections.forEach((d, i) => {
      const pct = Math.round(d.confidence * 100)
      const shown = d.wasPresented ? " - Shown on screen" : ""
      lines.push(`${i + 1}. ${d.verseRef} (${pct}%)${shown}`)
      if (d.verseText) lines.push(...wrapPdfLine(`   ${d.verseText}`))
    })
    lines.push("")
  }

  if (notes.length > 0) {
    lines.push("Notes")
    notes.forEach((n) => lines.push(...wrapPdfLine(`- ${n.content} (${formatSessionExportTime(n.createdAt)})`)))
    lines.push("")
  }

  if (transcript.length > 0) {
    lines.push("Transcript")
    lines.push(...wrapPdfLine(transcript.map((s) => s.text).join(" ")))
  }

  return lines
}

export function buildSessionPdfBytes(
  title: string,
  detections: SessionDetection[],
  notes: SessionNote[],
  transcript: SessionTranscriptSegment[],
) {
  const lines = buildPdfLines(title, detections, notes, transcript)
  const pages: string[][] = []
  const pageSize = 42

  for (let i = 0; i < lines.length; i += pageSize) {
    pages.push(lines.slice(i, i + pageSize))
  }
  if (pages.length === 0) pages.push([title])

  const objects: string[] = []
  const addObject = (body: string) => {
    objects.push(body)
    return objects.length
  }

  const catalogRef = addObject("<< /Type /Catalog /Pages 2 0 R >>")
  const pagesRef = addObject("PAGES_PLACEHOLDER")
  const fontRef = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
  const pageRefs: number[] = []

  for (const pageLines of pages) {
    const textOps = pageLines
      .map((line, index) => {
        const size = index === 0 && pageRefs.length === 0 ? 18 : 11
        const y = 760 - index * 16
        return `BT /F1 ${size} Tf 54 ${y} Td (${escapePdfText(line)}) Tj ET`
      })
      .join("\n")
    const stream = `${textOps}\n`
    const contentRef = addObject(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`)
    const pageRef = addObject(
      `<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontRef} 0 R >> >> /Contents ${contentRef} 0 R >>`,
    )
    pageRefs.push(pageRef)
  }

  objects[pagesRef - 1] = `<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(" ")}] /Count ${pageRefs.length} >>`
  objects[catalogRef - 1] = "<< /Type /Catalog /Pages 2 0 R >>"

  let pdf = "%PDF-1.4\n"
  const offsets: number[] = [0]

  objects.forEach((body, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })

  const xrefOffset = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`

  return new TextEncoder().encode(pdf)
}
