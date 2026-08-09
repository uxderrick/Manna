import { useEffect } from "react"
import { PanelHeader } from "@/components/ui/panel-header"
import { InteractiveVersePreview } from "@/components/panels/interactive-verse-preview"
import { useBibleStore, useBroadcastStore, useQueueStore, useSettingsStore } from "@/stores"
import { bibleActions } from "@/hooks/use-bible"
import { queueVerseToRenderData, toVerseRenderData } from "@/hooks/use-broadcast"
import type { TextHighlight } from "@/types"

export function PreviewPanel() {
  const selectedVerse = useBibleStore((s) => s.selectedVerse)
  const translations = useBibleStore((s) => s.translations)
  const activeTranslationId = useBibleStore((s) => s.activeTranslationId)
  const previewVerse = useBroadcastStore((s) => s.previewVerse)
  const queueItems = useQueueStore((s) => s.items)
  const activeIndex = useQueueStore((s) => s.activeIndex)
  const defaultHighlightColor = useSettingsStore((s) => s.defaultHighlightColor)

  // When translation changes, re-fetch the selected verse in the new translation
  useEffect(() => {
    const verse = useBibleStore.getState().selectedVerse
    if (verse && verse.book_number > 0 && verse.chapter > 0 && verse.verse > 0) {
      bibleActions
        .fetchVerse(verse.book_number, verse.chapter, verse.verse)
        .then((v) => {
          if (v) bibleActions.selectVerse(v)
        })
        .catch(() => {})
    }
  }, [activeTranslationId])
  const themes = useBroadcastStore((s) => s.themes)
  const activeThemeId = useBroadcastStore((s) => s.activeThemeId)

  const activeTheme = themes.find((t) => t.id === activeThemeId) ?? themes[0]
  const translation = translations.find((t) => t.id === activeTranslationId)?.abbreviation ?? "KJV"

  const activeItem = activeIndex === null ? null : queueItems[activeIndex]
  const activeVerseItem = activeItem?.kind === "verse" && selectedVerse &&
    activeItem.verse.translation_id === selectedVerse.translation_id &&
    activeItem.verse.book_number === selectedVerse.book_number &&
    activeItem.verse.chapter === selectedVerse.chapter &&
    activeItem.verse.verse === selectedVerse.verse
    ? activeItem
    : null
  const cleanVerseData = selectedVerse ? toVerseRenderData(selectedVerse, translation) : null
  const samePreview = cleanVerseData && previewVerse &&
    previewVerse.reference.replace(/ \(\w+\)$/, "") === cleanVerseData.reference.replace(/ \(\w+\)$/, "")
  const verseData = activeVerseItem
    ? queueVerseToRenderData(activeVerseItem, translation)
    : samePreview
      ? previewVerse
      : cleanVerseData

  const handleHighlightsChange = (highlights: TextHighlight[]) => {
    if (!verseData) return
    const next = highlights.length > 0 ? { ...verseData, highlights } : { ...verseData, highlights: undefined }
    if (activeVerseItem) {
      useQueueStore.getState().updateVerseHighlights(activeVerseItem.id, highlights)
    }
    useBroadcastStore.getState().setPreviewVerse(next)
  }

  return (
    <div
      data-slot="preview-panel"
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card"
    >
      <PanelHeader title="Program preview" />
      <div className="flex min-h-0 flex-1 items-center justify-center p-3">
        <InteractiveVersePreview
          key={`${verseData?.reference ?? "empty"}:${activeVerseItem?.id ?? "fresh"}`}
          theme={activeTheme}
          verse={verseData}
          defaultColor={defaultHighlightColor}
          onHighlightsChange={handleHighlightsChange}
        />
      </div>
    </div>
  )
}
