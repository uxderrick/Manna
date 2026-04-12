import { invoke } from "@tauri-apps/api/core"
import { useBibleStore } from "@/stores"
import type { Translation, Book, Verse, CrossReference } from "@/types"
import type { SemanticSearchResult } from "@/types/detection"

// Stable action functions that use getState() instead of closing over the store.
// This prevents the infinite re-render loop caused by useCallback deps changing every render.

async function loadTranslations() {
  const translations = await invoke<Translation[]>("list_translations")
  useBibleStore.getState().setTranslations(translations)
  return translations
}

async function loadBooks(translationId?: number) {
  const id = translationId ?? useBibleStore.getState().activeTranslationId
  const books = await invoke<Book[]>("list_books", { translationId: id })
  useBibleStore.getState().setBooks(books)
  return books
}

async function loadChapter(
  bookNumber: number,
  chapter: number,
  translationId?: number
) {
  const id = translationId ?? useBibleStore.getState().activeTranslationId
  const verses = await invoke<Verse[]>("get_chapter", {
    translationId: id,
    bookNumber,
    chapter,
  })
  useBibleStore.getState().setCurrentChapter(verses)
  return verses
}

async function fetchVerse(
  bookNumber: number,
  chapter: number,
  verse: number,
  translationId?: number
) {
  const id = translationId ?? useBibleStore.getState().activeTranslationId
  return invoke<Verse | null>("get_verse", {
    translationId: id,
    bookNumber,
    chapter,
    verse,
  })
}

async function searchVerses(
  query: string,
  limit = 20,
  translationId?: number
) {
  const id = translationId ?? useBibleStore.getState().activeTranslationId
  const results = await invoke<Verse[]>("search_verses", {
    query,
    translationId: id,
    limit,
  })
  useBibleStore.getState().setSearchResults(results)
  return results
}

async function semanticSearch(query: string, limit = 10) {
  const results = await invoke<SemanticSearchResult[]>("semantic_search", {
    query,
    limit,
  })
  useBibleStore.getState().setSemanticResults(results)
  return results
}

async function loadCrossReferences(
  bookNumber: number,
  chapter: number,
  verse: number
) {
  const refs = await invoke<CrossReference[]>("get_cross_references", {
    bookNumber,
    chapter,
    verse,
  })
  useBibleStore.getState().setCrossReferences(refs)
  return refs
}

// Exported stable references — these never change between renders
export const bibleActions = {
  loadTranslations,
  loadBooks,
  loadChapter,
  fetchVerse,
  searchVerses,
  semanticSearch,
  loadCrossReferences,
  navigateToVerse: (bookNumber: number, chapter: number, verse: number) =>
    useBibleStore
      .getState()
      .setPendingNavigation({ bookNumber, chapter, verse }),
  selectVerse: (verse: Verse | null) =>
    useBibleStore.getState().selectVerse(verse),
}

// Hook for components that need reactive store data
export function useBible() {
  const translations = useBibleStore((s) => s.translations)
  const activeTranslationId = useBibleStore((s) => s.activeTranslationId)
  const books = useBibleStore((s) => s.books)
  const currentChapter = useBibleStore((s) => s.currentChapter)
  const searchResults = useBibleStore((s) => s.searchResults)
  const semanticResults = useBibleStore((s) => s.semanticResults)
  const selectedVerse = useBibleStore((s) => s.selectedVerse)
  const crossReferences = useBibleStore((s) => s.crossReferences)

  return {
    translations,
    activeTranslationId,
    books,
    currentChapter,
    searchResults,
    semanticResults,
    selectedVerse,
    crossReferences,
    ...bibleActions,
  }
}
