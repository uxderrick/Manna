import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import * as cheerio from "cheerio"
import type { NormalizedHymn, NormalizedHymnal } from "./normalize"

const REPO_ROOT = new URL("../../", import.meta.url).pathname
const CACHE_DIR = join(REPO_ROOT, "scripts/hymnals/.cache/sankey")
const BASE = "https://www.traditionalmusic.co.uk/sacred-songs/"
const INDEX_URL = `${BASE}sacred-songs-and-solos.htm`

async function fetchCached(url: string): Promise<string> {
  await mkdir(CACHE_DIR, { recursive: true })
  const filename = url.replace(/[^a-z0-9]+/gi, "_") + ".html"
  const cached = join(CACHE_DIR, filename)
  if (existsSync(cached)) return readFile(cached, "utf-8")
  const resp = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      Referer: "https://www.google.com/",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "cross-site",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
    },
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`)
  const html = await resp.text()
  await writeFile(cached, html, "utf-8")
  return html
}

function parseHymnPage(html: string, number: number): NormalizedHymn | null {
  const $ = cheerio.load(html)
  const title = $("h1, h2").first().text().trim() || $("title").text().trim()
  if (!title) return null

  // Sankey pages: lyrics live in <p> or <pre> tags within the main content area.
  // Stanzas separated by blank lines or <br><br>.
  const body = $("body").text()
  const blocks = body
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 20 && !/^(copyright|home|next|prev|index)/i.test(b))

  const stanzas: string[][] = []
  let chorus: string[] | null = null

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter((l) => l.length > 0)
    if (lines.length < 2) continue
    // Treat lines starting with "Chorus" or "Refrain" as chorus marker.
    const firstLower = lines[0]?.toLowerCase() ?? ""
    if ((firstLower.startsWith("chorus") || firstLower.startsWith("refrain")) && !chorus) {
      chorus = lines.slice(1)
      continue
    }
    stanzas.push(lines)
  }

  if (stanzas.length === 0 && !chorus) return null

  return {
    number,
    title,
    author: null,
    stanzas,
    chorus,
    tune: null,
    meter: null,
    scriptureRef: null,
    category: null,
  }
}

export async function fetchSankey(): Promise<NormalizedHymnal> {
  console.log(`[sankey] Fetching index from ${INDEX_URL}`)
  const indexHtml = await fetchCached(INDEX_URL)
  const $ = cheerio.load(indexHtml)

  // Index has links like <a href="hymn-1-amazing-grace.htm">1 Amazing Grace</a>
  const links: { number: number; url: string }[] = []
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href")
    if (!href || !href.endsWith(".htm") || href === "sacred-songs-and-solos.htm") return
    const text = $(el).text().trim()
    const numMatch = text.match(/^(\d+)\s/)
    if (!numMatch) return
    const num = parseInt(numMatch[1], 10)
    links.push({ number: num, url: new URL(href, BASE).toString() })
  })
  // Deduplicate + sort
  const seen = new Set<number>()
  const unique = links.filter((l) => {
    if (seen.has(l.number)) return false
    seen.add(l.number)
    return true
  })
  unique.sort((a, b) => a.number - b.number)
  console.log(`[sankey] Found ${unique.length} hymn links`)

  const hymns: NormalizedHymn[] = []
  for (const { number, url } of unique) {
    try {
      const html = await fetchCached(url)
      const hymn = parseHymnPage(html, number)
      if (hymn) hymns.push(hymn)
    } catch (e) {
      console.warn(`[sankey] Skip #${number}: ${e instanceof Error ? e.message : e}`)
    }
  }

  return {
    hymnal: "sankey",
    name: "Sankey Sacred Songs & Solos",
    license: "Public domain",
    sourceUrl: BASE,
    hymns,
  }
}
