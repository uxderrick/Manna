import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { NormalizedHymn, NormalizedHymnal } from "./normalize"

const REPO_ROOT = new URL("../../", import.meta.url).pathname

interface GhsRawHymn {
  number: string
  title: string
  chorus: string | false | null
  verses: string[]
}

interface GhsRaw {
  hymns: Record<string, GhsRawHymn>
}

export async function fetchGhs(): Promise<NormalizedHymnal> {
  // Try new location first, fall back to legacy src-tauri/ghs.json.
  const candidates = [
    join(REPO_ROOT, "src-tauri/hymnals/ghs.json"),
    join(REPO_ROOT, "src-tauri/ghs.json"),
  ]
  let raw: string | null = null
  for (const path of candidates) {
    try {
      raw = await readFile(path, "utf-8")
      break
    } catch {
      /* try next */
    }
  }
  if (!raw) throw new Error("Cannot find ghs.json in src-tauri/ or src-tauri/hymnals/")

  const parsed = JSON.parse(raw) as GhsRaw | NormalizedHymnal
  // If already normalized, return it (idempotent).
  if ("hymns" in parsed && Array.isArray(parsed.hymns)) {
    return parsed as NormalizedHymnal
  }

  const ghsRaw = parsed as GhsRaw
  const hymns: NormalizedHymn[] = []
  for (const [key, hymn] of Object.entries(ghsRaw.hymns)) {
    const number = parseInt(hymn.number ?? key, 10)
    if (Number.isNaN(number)) continue
    const stanzas = (hymn.verses ?? [])
      .map((v) => v.split("\n").map((l) => l.trim()).filter((l) => l.length > 0))
      .filter((s) => s.length > 0)
    const chorusStr = typeof hymn.chorus === "string" ? hymn.chorus : ""
    const chorusLines = chorusStr
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
    hymns.push({
      number,
      title: hymn.title,
      author: null,
      stanzas,
      chorus: chorusLines.length > 0 ? chorusLines : null,
      tune: null,
      meter: null,
      scriptureRef: null,
      category: null,
    })
  }
  hymns.sort((a, b) => a.number - b.number)

  return {
    hymnal: "ghs",
    name: "DCLM (GHS)",
    license: "DCLM — free use within Manna",
    sourceUrl: "https://dclmfl.org/hymns-songs/",
    hymns,
  }
}
