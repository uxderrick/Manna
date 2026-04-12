import { useState, useEffect } from "react"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from "@/components/ui/drawer"
import { useDistributeSummaryDrawerStore } from "@/lib/distribute-summary-drawer"
import { useSession } from "@/hooks/use-session"
import { useSessionStore } from "@/stores"
import { save } from "@tauri-apps/plugin-dialog"

function buildTemplate(session: {
  title: string
  date: string
  speaker: string | null
}): string {
  return `# ${session.title}
Date: ${session.date}${session.speaker ? ` | Speaker: ${session.speaker}` : ""}

## Key Scriptures
- (detected verses will appear here)

## Summary
`
}

export function DistributeSummaryDrawer() {
  const { isOpen, sessionId, closeDistributeSummary } = useDistributeSummaryDrawerStore()
  const { updateSummary, getDetections } = useSession()
  const activeSession = useSessionStore((s) => s.activeSession)

  const [summaryText, setSummaryText] = useState("")
  const [format, setFormat] = useState<"markdown" | "text">("markdown")
  const [isSaving, setIsSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!isOpen || !activeSession) return
    if (activeSession.summary) {
      setSummaryText(activeSession.summary)
    } else {
      getDetections(activeSession.id)
        .then((detections) => {
          let template = buildTemplate(activeSession)
          if (detections.length > 0) {
            const verses = detections.map((d) => `- ${d.verseRef} (${d.translation})`).join("\n")
            template = template.replace(
              "- (detected verses will appear here)",
              verses
            )
          }
          setSummaryText(template)
        })
        .catch(() => {
          setSummaryText(buildTemplate(activeSession))
        })
    }
    setCopied(false)
  }, [isOpen, activeSession])

  async function saveSummaryIfEdited() {
    if (!sessionId) return
    if (summaryText.trim() && summaryText !== activeSession?.summary) {
      await updateSummary(sessionId, summaryText.trim())
      if (activeSession) {
        useSessionStore.getState().updateActiveSession({ summary: summaryText.trim() })
      }
    }
  }

  async function handleCopy() {
    await saveSummaryIfEdited()
    await navigator.clipboard.writeText(summaryText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleSaveFile() {
    setIsSaving(true)
    try {
      await saveSummaryIfEdited()
      const ext = format === "markdown" ? "md" : "txt"
      const title = activeSession?.title.replace(/\s+/g, "-").toLowerCase() ?? "summary"
      const filePath = await save({
        defaultPath: `${title}-summary.${ext}`,
        filters: [
          format === "markdown"
            ? { name: "Markdown", extensions: ["md"] }
            : { name: "Text", extensions: ["txt"] },
        ],
      })

      if (filePath) {
        const { writeTextFile } = await import("@tauri-apps/plugin-fs")
        await writeTextFile(filePath, summaryText)
        closeDistributeSummary()
      }
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Drawer open={isOpen} onOpenChange={(open) => !open && closeDistributeSummary()}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Distribute Summary</DrawerTitle>
          <DrawerDescription>
            Edit the summary, then copy or save it.
          </DrawerDescription>
        </DrawerHeader>

        <div className="space-y-4 px-4">
          <textarea
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            rows={10}
            value={summaryText}
            onChange={(e) => setSummaryText(e.target.value)}
          />

          <div className="space-y-2">
            <p className="text-sm font-medium">File format</p>
            <div className="flex gap-2">
              <button
                className={`rounded-md px-3 py-1.5 text-sm ${format === "markdown" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                onClick={() => setFormat("markdown")}
              >
                Markdown
              </button>
              <button
                className={`rounded-md px-3 py-1.5 text-sm ${format === "text" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                onClick={() => setFormat("text")}
              >
                Plain Text
              </button>
            </div>
          </div>
        </div>

        <DrawerFooter>
          <button
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            onClick={handleCopy}
          >
            {copied ? "Copied!" : "Copy to Clipboard"}
          </button>
          <button
            className="w-full rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
            onClick={handleSaveFile}
            disabled={isSaving}
          >
            {isSaving ? "Saving…" : "Save as File"}
          </button>
          <button
            className="w-full rounded-md px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
            onClick={closeDistributeSummary}
          >
            Cancel
          </button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
