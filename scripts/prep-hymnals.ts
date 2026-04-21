import { fetchGhs } from "./hymnals/fetch-ghs"
import { fetchMhb } from "./hymnals/fetch-mhb"
import { fetchSankey } from "./hymnals/fetch-sankey"
import { fetchSda } from "./hymnals/fetch-sda"
import { writeHymnal } from "./hymnals/normalize"

const adapters: Record<string, () => Promise<ReturnType<typeof fetchGhs>>> = {
  ghs: fetchGhs,
  sda: fetchSda,
  sankey: fetchSankey,
  mhb: fetchMhb,
}

async function main() {
  const onlyArg = process.argv.find((a) => a.startsWith("--only="))
  const only = onlyArg?.slice("--only=".length).split(",")
  const ids = only ?? Object.keys(adapters)

  for (const id of ids) {
    const fn = adapters[id]
    if (!fn) {
      console.warn(`[prep-hymnals] Unknown adapter: ${id} — skipping`)
      continue
    }
    try {
      console.log(`[prep-hymnals] Building ${id}…`)
      const data = await fn()
      const outPath = await writeHymnal(data)
      console.log(`[prep-hymnals] ${id} → ${outPath} (${data.hymns.length} hymns)`)
    } catch (e) {
      console.error(`[prep-hymnals] ${id} failed:`, e instanceof Error ? e.message : e)
      process.exitCode = 1
    }
  }
}

main()
