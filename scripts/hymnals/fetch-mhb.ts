import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { NormalizedHymn, NormalizedHymnal } from "./normalize"

const REPO_ROOT = new URL("../../", import.meta.url).pathname
const SOURCE = join(REPO_ROOT, "scripts/hymnals/.source/mhb-raw.json")

interface MhbRawHymn {
  number: number
  title: string
  author?: string | null
  stanzas?: string[][]
  verses?: string[][] // alias for stanzas
  chorus?: string[] | null
  tune?: string | null
  meter?: string | null
  scriptureRef?: string | null
  category?: string | null
}

export async function fetchMhb(): Promise<NormalizedHymnal> {
  if (!existsSync(SOURCE)) {
    throw new Error(
      `MHB raw source missing at ${SOURCE}. See docs/superpowers/plans/2026-04-21-multi-hymnal.md ` +
        `Task 10 — manual OCR step required before running prep:hymnals --only=mhb.`,
    )
  }

  const raw = JSON.parse(await readFile(SOURCE, "utf-8")) as { hymns: MhbRawHymn[] }
  const hymns: NormalizedHymn[] = []
  for (const h of raw.hymns) {
    if (!Number.isFinite(h.number) || !h.title) continue
    const stanzas = (h.stanzas ?? h.verses ?? [])
      .map((lines) => lines.map((l) => l.trim()).filter((l) => l.length > 0))
      .filter((s) => s.length > 0)
    const chorus = h.chorus
      ? h.chorus.map((l) => l.trim()).filter((l) => l.length > 0)
      : null
    if (stanzas.length === 0 && !chorus) continue

    hymns.push({
      number: h.number,
      title: h.title.trim(),
      author: h.author ?? null,
      stanzas,
      chorus: chorus && chorus.length > 0 ? chorus : null,
      tune: h.tune ?? null,
      meter: h.meter ?? null,
      scriptureRef: h.scriptureRef ?? null,
      category: h.category ?? null,
    })
  }
  hymns.sort((a, b) => a.number - b.number)

  return {
    hymnal: "mhb",
    name: "Methodist Hymn Book",
    license: "Public domain (1933 UK edition)",
    sourceUrl: "https://archive.org/details/hymnsancientmode0000unse_h8c0",
    hymns,
  }
}
