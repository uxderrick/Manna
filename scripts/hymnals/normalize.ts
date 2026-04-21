import { writeFile, mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"

export interface NormalizedHymn {
  number: number
  title: string
  author?: string | null
  stanzas: string[][] // array of stanzas; each stanza is array of lines
  chorus?: string[] | null
  tune?: string | null
  meter?: string | null
  scriptureRef?: string | null
  category?: string | null
}

export interface NormalizedHymnal {
  hymnal: string
  name: string
  license?: string
  sourceUrl?: string
  hymns: NormalizedHymn[]
}

const REPO_ROOT = new URL("../../", import.meta.url).pathname
const OUTPUT_DIR = join(REPO_ROOT, "src-tauri/hymnals")

export async function writeHymnal(data: NormalizedHymnal): Promise<string> {
  const outPath = join(OUTPUT_DIR, `${data.hymnal}.json`)
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, JSON.stringify(data, null, 2), "utf-8")
  return outPath
}
