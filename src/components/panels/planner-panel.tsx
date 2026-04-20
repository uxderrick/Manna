import { useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { PanelHeader } from "@/components/ui/panel-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  SearchIcon,
  XIcon,
  PlayIcon,
  ListOrderedIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  PlusIcon,
} from "lucide-react"
import { useBibleStore, useQueueStore, useBroadcastStore } from "@/stores"
import { toVerseRenderData } from "@/hooks/use-broadcast"
import type { Verse } from "@/types"

interface PlannedVerse {
  id: string
  verse: Verse
  reference: string
}

export function PlannerPanel() {
  const [planned, setPlanned] = useState<PlannedVerse[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<Verse[]>([])
  const [searching, setSearching] = useState(false)
  const activeTranslationId = useBibleStore((s) => s.activeTranslationId)
  const translations = useBibleStore((s) => s.translations)

  const handleSearch = async () => {
    if (searchQuery.trim().length < 2) return
    setSearching(true)
    try {
      const results = await invoke<Verse[]>("search_verses", {
        query: searchQuery.trim(),
        translationId: activeTranslationId,
        limit: 8,
      })
      setSearchResults(results)
    } catch {
      setSearchResults([])
    }
    setSearching(false)
  }

  const addVerse = (verse: Verse) => {
    const ref = `${verse.book_name} ${verse.chapter}:${verse.verse}`
    // Don't add duplicates
    if (planned.some(p => p.reference === ref)) return
    setPlanned(prev => [...prev, {
      id: crypto.randomUUID(),
      verse,
      reference: ref,
    }])
    setSearchResults([])
    setSearchQuery("")
  }

  const removeVerse = (id: string) => {
    setPlanned(prev => prev.filter(p => p.id !== id))
  }

  const moveUp = (index: number) => {
    if (index === 0) return
    setPlanned(prev => {
      const next = [...prev]
      ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
      return next
    })
  }

  const moveDown = (index: number) => {
    if (index >= planned.length - 1) return
    setPlanned(prev => {
      const next = [...prev]
      ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
      return next
    })
  }

  const loadToQueue = () => {
    const trans = translations.find(t => t.id === activeTranslationId)?.abbreviation ?? "KJV"
    for (const item of planned) {
      useQueueStore.getState().addItem({
        kind: "verse",
        id: crypto.randomUUID(),
        verse: item.verse,
        reference: item.reference,
        confidence: 1,
        source: "manual",
        added_at: Date.now(),
      })
    }
    // Preview the first verse
    if (planned.length > 0) {
      useBroadcastStore.getState().setPreviewVerse(
        toVerseRenderData(planned[0].verse, trans)
      )
    }
  }

  const handleGoLive = (item: PlannedVerse) => {
    const trans = translations.find(t => t.id === activeTranslationId)?.abbreviation ?? "KJV"
    useBroadcastStore.getState().setLiveVerse(toVerseRenderData(item.verse, trans))
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-card">
      <PanelHeader title="Sermon Planner">
        {planned.length > 0 && (
          <Badge variant="outline">{planned.length}</Badge>
        )}
      </PanelHeader>

      {/* Search to add verses */}
      <div className="flex shrink-0 gap-1.5 border-b border-border p-2">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search verses to add..."
            className="h-8 pl-8 text-xs"
          />
        </div>
        <Button size="sm" variant="outline" className="h-8 px-2" onClick={handleSearch} disabled={searching}>
          <PlusIcon className="size-3" />
        </Button>
      </div>

      {/* Search results dropdown */}
      {searchResults.length > 0 && (
        <div className="shrink-0 border-b border-border bg-muted/30">
          <div className="max-h-40 overflow-y-auto">
            {searchResults.map((verse) => (
              <button
                key={verse.id}
                onClick={() => addVerse(verse)}
                className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50"
              >
                <span className="shrink-0 text-[11px] font-semibold text-primary">
                  {verse.book_name} {verse.chapter}:{verse.verse}
                </span>
                <span className="line-clamp-1 font-serif text-[11px] text-muted-foreground">
                  {verse.text}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Planned verses list */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {planned.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-muted/50">
              <ListOrderedIcon className="size-5 text-muted-foreground/60" />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-muted-foreground">No scriptures planned</p>
              <p className="text-[0.625rem] leading-relaxed text-muted-foreground/60">
                Search and add verses to build your sermon scripture sequence.
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1 p-2">
          {planned.map((item, index) => (
            <div
              key={item.id}
              className="group flex items-start gap-2 rounded-lg bg-surface-elevated p-2.5 ring-1 ring-border"
            >
              {/* Order number */}
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-bold text-primary">
                {index + 1}
              </span>

              {/* Content */}
              <div className="min-w-0 flex-1">
                <span className="text-xs font-semibold text-foreground">{item.reference}</span>
                <p className="mt-0.5 line-clamp-1 font-serif text-[10px] text-muted-foreground">
                  {item.verse.text}
                </p>
                {/* Actions on hover */}
                <div className="mt-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button
                    size="xs"
                    className="gap-1 rounded-full px-2 text-[9px]"
                    onClick={() => handleGoLive(item)}
                  >
                    <PlayIcon className="size-2" />
                    Go Live
                  </Button>
                </div>
              </div>

              {/* Reorder + remove */}
              <div className="flex shrink-0 flex-col gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  onClick={() => moveUp(index)}
                  disabled={index === 0}
                  className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-25"
                >
                  <ChevronUpIcon className="size-3" />
                </button>
                <button
                  onClick={() => moveDown(index)}
                  disabled={index >= planned.length - 1}
                  className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-25"
                >
                  <ChevronDownIcon className="size-3" />
                </button>
                <button
                  onClick={() => removeVerse(item.id)}
                  className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <XIcon className="size-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Load to Queue button */}
      {planned.length > 0 && (
        <div className="shrink-0 border-t border-border p-2">
          <Button
            className="w-full gap-2 rounded-full"
            onClick={loadToQueue}
          >
            <ListOrderedIcon className="size-3.5" />
            Load All to Queue ({planned.length})
          </Button>
        </div>
      )}
    </div>
  )
}
