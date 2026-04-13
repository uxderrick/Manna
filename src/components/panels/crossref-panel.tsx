import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { PanelHeader } from "@/components/ui/panel-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { PlayIcon, PlusIcon, BookOpenIcon } from "lucide-react"
import { useBibleStore, useBroadcastStore, useQueueStore } from "@/stores"
import { bibleActions } from "@/hooks/use-bible"
import { toVerseRenderData } from "@/hooks/use-broadcast"
import type { CrossReference, Verse } from "@/types"

interface ResolvedCrossRef {
  ref: CrossReference
  bookName: string
  chapter: number
  verse: number
  verseText: string | null
}

function parseRef(ref: string): { bookNumber: number; chapter: number; verse: number } | null {
  // Format: "Gen.1.1" or "1John.3.16" or "Rev.22.21"
  const match = ref.match(/^(.+?)\.(\d+)\.(\d+)$/)
  if (!match) return null
  const abbrev = match[1]
  const chapter = parseInt(match[2])
  const verse = parseInt(match[3])

  // Map abbreviations to book numbers
  const BOOK_MAP: Record<string, number> = {
    "Gen": 1, "Exod": 2, "Lev": 3, "Num": 4, "Deut": 5,
    "Josh": 6, "Judg": 7, "Ruth": 8, "1Sam": 9, "2Sam": 10,
    "1Kgs": 11, "2Kgs": 12, "1Chr": 13, "2Chr": 14, "Ezra": 15,
    "Neh": 16, "Esth": 17, "Job": 18, "Ps": 19, "Prov": 20,
    "Eccl": 21, "Song": 22, "Isa": 23, "Jer": 24, "Lam": 25,
    "Ezek": 26, "Dan": 27, "Hos": 28, "Joel": 29, "Amos": 30,
    "Obad": 31, "Jonah": 32, "Mic": 33, "Nah": 34, "Hab": 35,
    "Zeph": 36, "Hag": 37, "Zech": 38, "Mal": 39,
    "Matt": 40, "Mark": 41, "Luke": 42, "John": 43, "Acts": 44,
    "Rom": 45, "1Cor": 46, "2Cor": 47, "Gal": 48, "Eph": 49,
    "Phil": 50, "Col": 51, "1Thess": 52, "2Thess": 53,
    "1Tim": 54, "2Tim": 55, "Titus": 56, "Phlm": 57, "Heb": 58,
    "Jas": 59, "1Pet": 60, "2Pet": 61, "1John": 62, "2John": 63,
    "3John": 64, "Jude": 65, "Rev": 66,
  }

  const bookNumber = BOOK_MAP[abbrev]
  if (!bookNumber) return null
  return { bookNumber, chapter, verse }
}

function CrossRefCard({ crossRef }: { crossRef: ResolvedCrossRef }) {
  const liveVerse = useBroadcastStore((s) => s.liveVerse)
  const isLive = liveVerse?.reference?.includes(`${crossRef.bookName} ${crossRef.chapter}:${crossRef.verse}`) ?? false

  const handleGoLive = () => {
    if (!crossRef.verseText) return
    const verse: Verse = {
      id: 0,
      translation_id: useBibleStore.getState().activeTranslationId,
      book_number: parseRef(crossRef.ref.to_ref)?.bookNumber ?? 0,
      book_name: crossRef.bookName,
      book_abbreviation: "",
      chapter: crossRef.chapter,
      verse: crossRef.verse,
      text: crossRef.verseText,
    }
    bibleActions.selectVerse(verse)
    const trans = useBibleStore.getState().translations
      .find(t => t.id === useBibleStore.getState().activeTranslationId)?.abbreviation ?? "KJV"
    useBroadcastStore.getState().setLiveVerse(toVerseRenderData(verse, trans))
  }

  const handleAddToQueue = () => {
    if (!crossRef.verseText) return
    const verse: Verse = {
      id: 0,
      translation_id: useBibleStore.getState().activeTranslationId,
      book_number: parseRef(crossRef.ref.to_ref)?.bookNumber ?? 0,
      book_name: crossRef.bookName,
      book_abbreviation: "",
      chapter: crossRef.chapter,
      verse: crossRef.verse,
      text: crossRef.verseText,
    }
    useQueueStore.getState().addItem({
      id: crypto.randomUUID(),
      verse,
      reference: `${crossRef.bookName} ${crossRef.chapter}:${crossRef.verse}`,
      confidence: 1,
      source: "manual",
      added_at: Date.now(),
    })
  }

  return (
    <div className="group cursor-pointer rounded-lg p-2.5 transition-colors hover:bg-muted/50">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-primary">
          {crossRef.bookName} {crossRef.chapter}:{crossRef.verse}
        </span>
        <Badge variant="outline" className="text-[8px] tabular-nums">
          {crossRef.ref.votes}
        </Badge>
        {isLive && (
          <span className="ml-auto flex items-center gap-1 rounded-full bg-red-600 px-1.5 py-0.5 text-[8px] font-semibold text-white">
            Live
          </span>
        )}
      </div>
      {crossRef.verseText && (
        <p className="mt-1 line-clamp-2 font-serif text-[11px] leading-relaxed text-muted-foreground">
          {crossRef.verseText}
        </p>
      )}
      <div className="mt-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <Button
          size="xs"
          className="gap-1 rounded-full px-2 text-[9px]"
          onClick={handleGoLive}
          disabled={!crossRef.verseText}
        >
          <PlayIcon className="size-2.5" />
          Go Live
        </Button>
        <Button
          variant="outline"
          size="xs"
          className="gap-1 rounded-full px-2 text-[9px]"
          onClick={handleAddToQueue}
          disabled={!crossRef.verseText}
        >
          <PlusIcon className="size-2.5" />
          Add
        </Button>
      </div>
    </div>
  )
}

export function CrossRefPanel() {
  const selectedVerse = useBibleStore((s) => s.selectedVerse)
  const activeTranslationId = useBibleStore((s) => s.activeTranslationId)
  const books = useBibleStore((s) => s.books)
  const [crossRefs, setCrossRefs] = useState<ResolvedCrossRef[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!selectedVerse || selectedVerse.book_number <= 0) {
      setCrossRefs([])
      return
    }

    let cancelled = false
    setLoading(true)

    ;(async () => {
      try {
        const refs = await invoke<CrossReference[]>("get_cross_references", {
          bookNumber: selectedVerse.book_number,
          chapter: selectedVerse.chapter,
          verse: selectedVerse.verse,
        })

        if (cancelled) return

        // Sort by votes (highest first) and take top 20
        const sorted = refs.sort((a, b) => b.votes - a.votes).slice(0, 20)

        // Resolve each cross-reference to get book name and verse text
        const resolved: ResolvedCrossRef[] = []
        for (const ref of sorted) {
          const parsed = parseRef(ref.to_ref)
          if (!parsed) continue

          const book = books.find(b => b.book_number === parsed.bookNumber)
          if (!book) continue

          let verseText: string | null = null
          try {
            const v = await invoke<Verse | null>("get_verse", {
              translationId: activeTranslationId,
              bookNumber: parsed.bookNumber,
              chapter: parsed.chapter,
              verse: parsed.verse,
            })
            if (v) verseText = v.text
          } catch {}

          resolved.push({
            ref,
            bookName: book.name,
            chapter: parsed.chapter,
            verse: parsed.verse,
            verseText,
          })
        }

        if (!cancelled) {
          setCrossRefs(resolved)
          setLoading(false)
        }
      } catch {
        if (!cancelled) {
          setCrossRefs([])
          setLoading(false)
        }
      }
    })()

    return () => { cancelled = true }
  }, [selectedVerse?.book_number, selectedVerse?.chapter, selectedVerse?.verse, activeTranslationId, books])

  return (
    <div
      data-slot="crossref-panel"
      className="flex h-full min-w-0 flex-col overflow-hidden bg-card"
    >
      <PanelHeader title="Cross-References">
        {crossRefs.length > 0 && (
          <Badge variant="outline">{crossRefs.length}</Badge>
        )}
      </PanelHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!selectedVerse && (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-muted/50">
              <BookOpenIcon className="size-5 text-muted-foreground/60" />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-muted-foreground">No verse selected</p>
              <p className="text-[0.625rem] leading-relaxed text-muted-foreground/60">
                Select a verse from search or detections to see related cross-references.
              </p>
            </div>
          </div>
        )}

        {selectedVerse && loading && (
          <div className="flex items-center justify-center py-12">
            <p className="text-xs text-muted-foreground">Loading cross-references...</p>
          </div>
        )}

        {selectedVerse && !loading && crossRefs.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <p className="text-xs font-medium text-muted-foreground">No cross-references found</p>
            <p className="text-[0.625rem] text-muted-foreground/60">
              {selectedVerse.book_name} {selectedVerse.chapter}:{selectedVerse.verse}
            </p>
          </div>
        )}

        {crossRefs.length > 0 && (
          <div className="flex flex-col gap-0.5 p-1.5">
            {crossRefs.map((cr, idx) => (
              <CrossRefCard key={`${cr.ref.to_ref}-${idx}`} crossRef={cr} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
