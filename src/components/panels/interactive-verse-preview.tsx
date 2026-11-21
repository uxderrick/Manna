import { useCallback, useEffect, useRef, useState } from "react"
import { EraserIcon } from "lucide-react"
import { CanvasVerse } from "@/components/ui/canvas-verse"
import { Button } from "@/components/ui/button"
import type { BroadcastTheme, TextHighlight, VerseRenderData, WordHitBox } from "@/types"
import type { VerseLayoutMetrics } from "@/lib/verse-renderer"
import {
  HIGHLIGHT_COLORS,
  applyHighlight,
  clearHighlightRange,
  rangeFromWordHits,
  wordHitAtPoint,
  nearestWordHitAtPoint,
} from "@/lib/text-highlights"

type SelectionRange = Pick<TextHighlight, "segmentIndex" | "start" | "end">

interface InteractiveVersePreviewProps {
  theme: BroadcastTheme
  verse: VerseRenderData | null
  defaultColor: string
  onHighlightsChange: (highlights: TextHighlight[]) => void
}

export function InteractiveVersePreview({
  theme,
  verse,
  defaultColor,
  onHighlightsChange,
}: InteractiveVersePreviewProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const hitsRef = useRef<WordHitBox[]>([])
  const anchorRef = useRef<{ word: WordHitBox; x: number; y: number; pointerId: number } | null>(null)
  const [selection, setSelection] = useState<SelectionRange | null>(null)
  const [toolbar, setToolbar] = useState<{ x: number; y: number } | null>(null)
  const [selectionReference, setSelectionReference] = useState(verse?.reference)
  if (selectionReference !== verse?.reference) {
    setSelectionReference(verse?.reference)
    setSelection(null)
    setToolbar(null)
  }

  const handleRender = useCallback((result: VerseLayoutMetrics | null) => {
    hitsRef.current = result?.wordHits ?? []
  }, [])

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setToolbar(null)
        setSelection(null)
      }
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        anchorRef.current = null
        setToolbar(null)
        setSelection(null)
      }
    }
    window.addEventListener("pointerdown", dismiss)
    window.addEventListener("keydown", escape)
    return () => {
      window.removeEventListener("pointerdown", dismiss)
      window.removeEventListener("keydown", escape)
    }
  }, [])

  const hitFromEvent = (event: React.PointerEvent<HTMLDivElement>, dragging = false) => {
    const canvas = rootRef.current?.querySelector("canvas")
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    return dragging
      ? nearestWordHitAtPoint(hitsRef.current, x, y)
      : wordHitAtPoint(hitsRef.current, x, y, 4)
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0) return
    const hit = hitFromEvent(event)
    if (!hit) {
      setToolbar(null)
      setSelection(null)
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    anchorRef.current = { word: hit, x: event.clientX, y: event.clientY, pointerId: event.pointerId }
    setToolbar(null)
    setSelection({ segmentIndex: hit.segmentIndex, start: hit.start, end: hit.end })
  }

  const rangeFromEvent = (event: React.PointerEvent<HTMLDivElement>) => {
    const anchor = anchorRef.current
    if (!anchor || event.pointerId !== anchor.pointerId) return null
    // A click or small hand movement must keep exactly the word first selected.
    const dragging = Math.hypot(event.clientX - anchor.x, event.clientY - anchor.y) >= 4
    return rangeFromWordHits(anchor.word, dragging ? hitFromEvent(event, true) : anchor.word)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const range = rangeFromEvent(event)
    if (range) setSelection(range)
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!anchorRef.current || event.pointerId !== anchorRef.current.pointerId || event.button !== 0) return
    // Read the release position directly; the last pointermove may not have rendered.
    const range = rangeFromEvent(event)
    anchorRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    const text = verse?.segments[0]?.text
    if (!range || !verse || !text) return
    setSelection(range)
    const rect = event.currentTarget.getBoundingClientRect()
    setToolbar({
      x: Math.max(8, Math.min(event.clientX - rect.left, rect.width - 220)),
      y: Math.max(8, event.clientY - rect.top - 44),
    })
  }

  const cancelDrag = () => {
    if (!anchorRef.current) return
    anchorRef.current = null
    setSelection(null)
    setToolbar(null)
  }

  const applyColor = (color: string) => {
    const text = verse?.segments[0]?.text
    if (!verse || !text || !selection) return
    onHighlightsChange(applyHighlight(text, verse.highlights ?? [], {
      ...selection,
      color,
      sourceText: text.slice(selection.start, selection.end),
    }))
    setToolbar(null)
    setSelection(null)
  }

  const clearColor = () => {
    const text = verse?.segments[0]?.text
    if (!verse || !text || !selection) return
    onHighlightsChange(clearHighlightRange(text, verse.highlights ?? [], selection))
    setToolbar(null)
    setSelection(null)
  }

  const selectionText = verse?.segments[0]?.text
  const displayVerse = verse && selection && selectionText
    ? {
        ...verse,
        highlights: applyHighlight(selectionText, verse.highlights ?? [], {
          ...selection,
          color: defaultColor,
          sourceText: selectionText.slice(selection.start, selection.end),
        }),
      }
    : verse

  return (
    <div
      ref={rootRef}
      className="relative w-full cursor-text touch-none select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={cancelDrag}
      onLostPointerCapture={cancelDrag}
    >
      <CanvasVerse theme={theme} verse={displayVerse} onRenderResult={handleRender} />
      {toolbar ? (
        <div
          role="toolbar"
          aria-label="Passage highlight colors"
          className="absolute z-20 flex items-center gap-1 rounded-lg border border-border bg-popover p-1.5 shadow-lg"
          style={{ left: toolbar.x, top: toolbar.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {HIGHLIGHT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              autoFocus={color === defaultColor}
              aria-label={`Highlight ${color}`}
              onClick={() => applyColor(color)}
              className="size-6 rounded-full border-2 transition-transform hover:scale-110"
              style={{
                backgroundColor: color,
                borderColor: color === defaultColor ? "var(--foreground)" : "transparent",
              }}
            />
          ))}
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Clear highlight" onClick={clearColor}>
            <EraserIcon className="size-3.5" />
          </Button>
        </div>
      ) : null}
    </div>
  )
}
