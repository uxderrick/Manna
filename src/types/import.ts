/** Other worship software whose libraries Manna can find on this computer. */
export type ImportSourceKind = "openlp" | "easyworship" | "propresenter"

/** A library found in its default install location. */
export interface DetectedImportSource {
  kind: ImportSourceKind
  path: string
  /** e.g. "OpenLP", "EasyWorship · Default", "ProPresenter 7 · Default" */
  label: string
  /** e.g. ["175 songs", "4 Bibles"] */
  contents: string[]
}

export interface ImportFailure {
  item: string
  reason: string
}

/** Songs, custom slides and services written to Manna's library. */
export interface ContentImportReport {
  found: number
  imported: number
  updated: number
  skippedExisting: number
  failed: ImportFailure[]
  /** Service-plan templates created (services, custom slides). */
  templates: string[]
  /** Templates left alone because one with that name already exists. */
  templatesSkipped: string[]
  /** Service songs matched to a song already in Manna. */
  songsLinked: number
}

export type BibleImportStatus =
  | "imported"
  | "updated"
  | "skippedExisting"
  | "alreadyInManna"

export interface BibleImportReport {
  /** Set when the Bible is in Manna's imported-Bible store. */
  translationId: number | null
  title: string
  abbreviation: string
  language: string
  status: BibleImportStatus
  books: number
  verses: number
  /** Books outside the 66-book canon (e.g. apocrypha) that were left out. */
  skippedBooks: string[]
}

export interface ContentImportResult {
  report: ContentImportReport
  bibles: BibleImportReport[]
}
