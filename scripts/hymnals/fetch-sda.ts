import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { readFile, readdir, stat } from "node:fs/promises"
import { join } from "node:path"
import type { NormalizedHymn, NormalizedHymnal } from "./normalize"

const REPO_ROOT = new URL("../../", import.meta.url).pathname
const CACHE_DIR = join(REPO_ROOT, "scripts/hymnals/.cache/sda")
const REPO_URL = "https://github.com/GospelSounders/adventhymnals.git"

// The repo stores each hymn as a Grav-CMS page: a folder with a `docs.md` file
// containing YAML frontmatter, a heading, a ```txt fenced lyrics block, and a
// metadata table below.
//
// Canonical SDA hymnal lives under:
//   content/04.seventh-day-adventist-hymnal/<range>/<sub-range>/<NN.slug>/docs.md
const SDA_CONTENT_ROOT = join(
  CACHE_DIR,
  "content",
  "04.seventh-day-adventist-hymnal",
)

async function walkDocsMd(dir: string): Promise<string[]> {
  const results: string[] = []
  const entries = await readdir(dir)
  for (const entry of entries) {
    const full = join(dir, entry)
    let st
    try {
      st = await stat(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      const nested = await walkDocsMd(full)
      results.push(...nested)
    } else if (entry === "docs.md") {
      results.push(full)
    }
  }
  return results
}

/** Extract the ```txt fenced block (lyrics) from a hymn docs.md. */
function extractLyricsBlock(md: string): string | null {
  // Prefer ```txt, fall back to generic fenced block.
  const txt = md.match(/```txt\s*\n([\s\S]*?)\n```/i)
  if (txt) return txt[1]
  const any = md.match(/```\s*\n([\s\S]*?)\n```/)
  return any ? any[1] : null
}

/** Parse a lyrics block into stanzas + (optional) chorus. */
function parseLyrics(block: string): { stanzas: string[][]; chorus: string[] | null } {
  const lines = block.replace(/\r\n/g, "\n").split("\n")
  // Group by blank-line boundaries.
  const groups: string[][] = []
  let current: string[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (line.length === 0) {
      if (current.length > 0) {
        groups.push(current)
        current = []
      }
    } else {
      current.push(line)
    }
  }
  if (current.length > 0) groups.push(current)

  const stanzas: string[][] = []
  let chorus: string[] | null = null

  for (const group of groups) {
    if (group.length === 0) continue
    const head = group[0].toLowerCase().replace(/[:.\s]+$/g, "")
    const isChorusMarker =
      head === "chorus" ||
      head === "refrain" ||
      head.startsWith("chorus ") ||
      head.startsWith("refrain ")
    const numericMarker = /^\s*\d+\s*\.?\s*$/.test(group[0])

    let body = group
    if (isChorusMarker || numericMarker) {
      body = group.slice(1)
    }
    // Drop trailing standalone marker lines too.
    body = body.filter((l) => l.trim().length > 0)
    if (body.length === 0) continue

    if (isChorusMarker) {
      if (!chorus) chorus = body
      // ignore repeated refrain blocks
    } else {
      stanzas.push(body)
    }
  }
  return { stanzas, chorus }
}

/** Parse the key/value metadata table at the bottom of each docs.md. */
function parseMetaTable(md: string): Record<string, string> {
  const meta: Record<string, string> = {}
  // The table lives AFTER the fenced lyrics block. Find where the fenced block
  // closes, then process only what follows line-by-line.
  const closeIdx = md.lastIndexOf("```")
  const tail = closeIdx >= 0 ? md.slice(closeIdx + 3) : md
  for (const rawLine of tail.split("\n")) {
    const line = rawLine.trim()
    if (!line) continue
    // Skip header separator like `-------|-------` or `- |   -  |`.
    if (/^[-\s|]+$/.test(line)) continue
    const pipeIdx = line.indexOf("|")
    if (pipeIdx < 0) continue
    const key = line.slice(0, pipeIdx).trim().toLowerCase()
    // Strip a trailing pipe on the value side, keep internal pipes intact.
    let value = line.slice(pipeIdx + 1).trim()
    if (value.endsWith("|")) value = value.slice(0, -1).trim()
    // If value itself contains another pipe (e.g. `| Joachim | Neander |`),
    // take only the content before the NEXT pipe.
    const nextPipe = value.indexOf("|")
    if (nextPipe >= 0) value = value.slice(0, nextPipe).trim()
    if (!key || !value) continue
    if (value === "undefined" || value === "-") continue
    if (!/^[A-Za-z#]/.test(key)) continue
    meta[key] = value
  }
  return meta
}

/** Extract hymn number and title from filepath + markdown heading. */
function parseNumberAndTitle(
  filepath: string,
  md: string,
): { number: number; title: string } | null {
  // Heading: `## 1. PRAISE TO THE LORD` (preferred source of truth for number).
  const headingMatch = md.match(/^##\s+(\d+)\.\s*(.+?)\s*$/m)
  if (headingMatch) {
    const number = parseInt(headingMatch[1], 10)
    const titleUpper = headingMatch[2].trim()
    return { number, title: titleUpper }
  }
  // Fallback: frontmatter `title: N. Name - ...`.
  const titleMatch = md.match(/^title:\s*(\d+)\.\s*(.+?)(?:\s+-\s+|$)/m)
  if (titleMatch) {
    return { number: parseInt(titleMatch[1], 10), title: titleMatch[2].trim() }
  }
  // Final fallback: folder name like `01.Praise-to-the-Lord`.
  const folder = filepath.split("/").slice(-2, -1)[0] ?? ""
  const folderMatch = folder.match(/^(\d+)\.(.+)$/)
  if (folderMatch) {
    return {
      number: parseInt(folderMatch[1], 10),
      title: folderMatch[2].replace(/-/g, " ").trim(),
    }
  }
  return null
}

/** Title-case a string that may be ALL CAPS. */
function normalizeTitle(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return trimmed
  // If mostly uppercase, title-case it.
  const letters = trimmed.replace(/[^A-Za-z]/g, "")
  if (letters.length > 0 && letters === letters.toUpperCase()) {
    return trimmed
      .toLowerCase()
      .replace(/(^|[\s'\-"(])(\p{L})/gu, (_m, pre, ch) => pre + ch.toUpperCase())
  }
  return trimmed
}

export async function fetchSda(): Promise<NormalizedHymnal> {
  if (!existsSync(CACHE_DIR)) {
    console.log(`[sda] Cloning ${REPO_URL} …`)
    execFileSync("git", ["clone", "--depth=1", REPO_URL, CACHE_DIR], { stdio: "inherit" })
  } else {
    console.log(`[sda] Using cached clone at ${CACHE_DIR}`)
  }

  if (!existsSync(SDA_CONTENT_ROOT)) {
    throw new Error(
      `SDA hymnal folder not found at ${SDA_CONTENT_ROOT}. Inspect ${CACHE_DIR} structure and update fetch-sda.ts.`,
    )
  }

  const docsFiles = await walkDocsMd(SDA_CONTENT_ROOT)
  console.log(`[sda] Walked ${docsFiles.length} docs.md files`)

  const hymns: NormalizedHymn[] = []
  const seen = new Set<number>()
  let skipped = 0

  for (const file of docsFiles) {
    let md: string
    try {
      md = await readFile(file, "utf-8")
    } catch {
      skipped++
      continue
    }

    const numTitle = parseNumberAndTitle(file, md)
    if (!numTitle) {
      skipped++
      continue
    }
    const { number } = numTitle
    if (!Number.isFinite(number) || number <= 0) {
      skipped++
      continue
    }
    if (seen.has(number)) {
      skipped++
      continue
    }

    const lyricsBlock = extractLyricsBlock(md)
    if (!lyricsBlock) {
      skipped++
      continue
    }
    const { stanzas, chorus } = parseLyrics(lyricsBlock)
    if (stanzas.length === 0 && !chorus) {
      skipped++
      continue
    }

    const meta = parseMetaTable(md)
    const metaTitle = meta["title"]
    const title = normalizeTitle(metaTitle || numTitle.title)

    const author = meta["author"] || null
    const tune = meta["tune"] || null
    const meter = meta["metrical pattern"] || meta["meter"] || null
    const category = meta["subjects"] || meta["topic"] || null
    const scriptureRef = meta["scripture song"] || meta["texts"] || null

    hymns.push({
      number,
      title,
      author,
      stanzas,
      chorus,
      tune,
      meter,
      scriptureRef,
      category,
    })
    seen.add(number)
  }

  hymns.sort((a, b) => a.number - b.number)
  console.log(`[sda] Parsed ${hymns.length} hymns (skipped ${skipped})`)

  return {
    hymnal: "sda",
    name: "SDA Hymnal",
    license: "Apache-2.0 (attribution: GospelSounders/adventhymnals)",
    sourceUrl: "https://github.com/GospelSounders/adventhymnals",
    hymns,
  }
}
