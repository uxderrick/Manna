import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useSongStore } from "@/stores"
import type { GeniusHit } from "@/types"

export function GeniusSearchResults({ query }: { query: string }) {
  const [hits, setHits] = useState<GeniusHit[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importingId, setImportingId] = useState<number | null>(null)

  useEffect(() => {
    if (!query.trim()) {
      setHits([])
      setError(null)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    const timer = setTimeout(async () => {
      try {
        const results = await useSongStore.getState().geniusSearch(query)
        if (cancelled) return
        setHits(results)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : "Failed to search Genius.")
        setHits([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 300)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  async function handleImport(hit: GeniusHit) {
    setImportingId(hit.id)
    try {
      await useSongStore.getState().geniusImport(hit)
      toast.success(`Imported "${hit.title}"`)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import failed."
      toast.error(message)
    } finally {
      setImportingId(null)
    }
  }

  if (!query.trim()) {
    return (
      <div className="p-4 text-xs text-muted-foreground">
        Type in the search box above to look up songs on Genius.
      </div>
    )
  }

  if (loading) {
    return <div className="p-4 text-xs text-muted-foreground">Searching…</div>
  }

  if (error) {
    return <div className="p-4 text-xs text-red-500">{error}</div>
  }

  if (hits.length === 0) {
    return (
      <div className="p-4 text-xs text-muted-foreground">
        No results. Try different words or paste lyrics manually.
      </div>
    )
  }

  return (
    <ul className="divide-y">
      {hits.map((hit) => (
        <li key={hit.id} className="flex items-center gap-3 p-3">
          {hit.thumbnailUrl ? (
            <img
              src={hit.thumbnailUrl}
              alt=""
              className="h-10 w-10 shrink-0 rounded object-cover"
            />
          ) : (
            <div className="h-10 w-10 shrink-0 rounded bg-muted" />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{hit.title}</div>
            <div className="truncate text-xs text-muted-foreground">{hit.artist}</div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => handleImport(hit)}
            disabled={importingId === hit.id}
          >
            {importingId === hit.id ? "Importing…" : "Import"}
          </Button>
        </li>
      ))}
    </ul>
  )
}
