import { invoke } from "@tauri-apps/api/core"
import type {
  ContentImportResult,
  DetectedImportSource,
  Translation,
} from "@/types"

/** File types the import picker accepts (Manna detects what each holds). */
export const IMPORT_FILE_EXTENSIONS = [
  // OpenLP: song / custom-slide / Bible databases, services
  "sqlite",
  "osz",
  "oszl",
  // EasyWorship: Songs.db, schedules
  "db",
  "ewsx",
  // ProPresenter 4–7 documents and exported playlists
  "pro",
  "pro6",
  "pro5",
  "pro4",
  "pro6plx",
  "proPlaylist",
  // CCLI SongSelect lyric files
  "txt",
  "usr",
  "bin",
  // Bible XML (OSIS, Zefania, OpenSong)
  "xml",
  "osis",
  "zefania",
]

export function detectImportSources(): Promise<DetectedImportSource[]> {
  return invoke<DetectedImportSource[]>("detect_import_sources")
}

/**
 * Import whatever the given files / folders contain, then refresh the parts
 * of the app that show imported content.
 */
export async function importContent(
  paths: string[],
  overwrite: boolean
): Promise<ContentImportResult> {
  const result = await invoke<ContentImportResult>("import_content", {
    paths,
    overwrite,
  })
  const { report, bibles } = result
  if (report.imported + report.updated > 0) {
    const { useSongStore } = await import("@/stores/song-store")
    await useSongStore.getState().hydrateSongs()
  }
  if (bibles.some((b) => b.status === "imported" || b.status === "updated")) {
    const { useBibleStore } = await import("@/stores")
    const translations = await invoke<Translation[]>("list_translations")
    useBibleStore.getState().setTranslations(translations)
  }
  return result
}

/** One-line summary of an import, for toasts and the result card. */
export function summarizeImport({ report, bibles }: ContentImportResult): string {
  const parts: string[] = []
  const songs = report.imported + report.updated
  if (songs > 0) parts.push(`${songs} song${songs === 1 ? "" : "s"}`)
  if (report.templates.length > 0) {
    const n = report.templates.length
    parts.push(`${n} plan template${n === 1 ? "" : "s"}`)
  }
  const newBibles = bibles.filter(
    (b) => b.status === "imported" || b.status === "updated"
  ).length
  if (newBibles > 0) parts.push(`${newBibles} Bible${newBibles === 1 ? "" : "s"}`)
  return parts.length > 0 ? `Imported ${parts.join(", ")}` : "Nothing new to import"
}
