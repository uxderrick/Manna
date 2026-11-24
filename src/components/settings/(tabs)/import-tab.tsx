import { useCallback, useEffect, useState } from "react"
import { open as openDialog } from "@tauri-apps/plugin-dialog"
import {
  FileUpIcon,
  FolderOpenIcon,
  LibraryIcon,
  Loader2Icon,
  RefreshCwIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  detectImportSources,
  importContent,
  IMPORT_FILE_EXTENSIONS,
  summarizeImport,
} from "@/lib/content-import"
import type {
  BibleImportReport,
  ContentImportResult,
  DetectedImportSource,
} from "@/types"

/** What each program can bring into Manna, shown under "Supported". */
const SUPPORTED: { app: string; brings: string; files: string }[] = [
  {
    app: "OpenLP",
    brings: "Songs, custom slides, Bibles, services",
    files: "Data folder · songs.sqlite · custom.sqlite · Bible .sqlite · .osz",
  },
  {
    app: "EasyWorship 6 / 7",
    brings: "Songs, schedules",
    files: "Profile folder · Songs.db · .ewsx",
  },
  {
    app: "ProPresenter 4 – 7",
    brings: "Songs, playlists",
    files: "Library folder · .pro · .pro6 · .proPlaylist · .pro6plx",
  },
  {
    app: "SongSelect",
    brings: "Songs (with your CCLI licence)",
    files: ".txt · .usr",
  },
  {
    app: "Bible files",
    brings: "Bible translations",
    files: "OSIS · Zefania · OpenSong .xml",
  },
]

const BIBLE_STATUS: Record<BibleImportReport["status"], string> = {
  imported: "Added",
  updated: "Replaced",
  skippedExisting: "Already imported",
  alreadyInManna: "Already in Manna",
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`
}

function ResultCard({
  source,
  result,
}: {
  source: string
  result: ContentImportResult
}) {
  const { report, bibles } = result
  const songLine = [
    report.imported > 0 && `${plural(report.imported, "added", "added")}`,
    report.updated > 0 && `${report.updated} replaced`,
    report.skippedExisting > 0 && `${report.skippedExisting} already in Manna`,
    report.songsLinked > 0 &&
      `${plural(report.songsLinked, "service song")} matched to your library`,
  ].filter(Boolean)

  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-md border border-border p-3"
    >
      <div className="text-sm font-medium">
        {source}
        <span className="font-normal text-muted-foreground">
          {" "}
          · {summarizeImport(result)}
        </span>
      </div>

      {songLine.length > 0 && (
        <ResultRow label="Songs" value={songLine.join(" · ")} />
      )}
      {report.templates.length > 0 && (
        <ResultRow
          label="Plan templates"
          value={report.templates.join(" · ")}
        />
      )}
      {report.templatesSkipped.length > 0 && (
        <ResultRow
          label="Kept as is"
          value={`${report.templatesSkipped.join(" · ")}. Turn on “Replace earlier imports” to update them.`}
        />
      )}
      {bibles.length > 0 && (
        <ResultRow
          label="Bibles"
          value={bibles
            .map(
              (b) =>
                `${b.abbreviation} — ${BIBLE_STATUS[b.status]}${
                  b.status === "imported" || b.status === "updated"
                    ? ` (${plural(b.verses, "verse")})`
                    : ""
                }`
            )
            .join(" · ")}
        />
      )}
      {report.failed.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-[0.625rem] font-semibold tracking-wider text-muted-foreground uppercase">
            Not imported
          </div>
          <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            {report.failed.slice(0, 8).map((f, i) => (
              <li key={`${f.item}-${i}`} className="truncate" title={f.reason}>
                <span className="text-foreground">{f.item}</span> — {f.reason}
              </li>
            ))}
            {report.failed.length > 8 && (
              <li>…and {report.failed.length - 8} more</li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="text-[0.625rem] font-semibold tracking-wider text-muted-foreground uppercase">
        {label}
      </div>
      <div className="text-xs">{value}</div>
    </div>
  )
}

export function ImportSection() {
  const [detected, setDetected] = useState<DetectedImportSource[] | null>(null)
  const [overwrite, setOverwrite] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [last, setLast] = useState<{
    source: string
    result: ContentImportResult
  } | null>(null)

  const scan = useCallback(async () => {
    setDetected(null)
    try {
      setDetected(await detectImportSources())
    } catch (e) {
      setDetected([])
      toast.error(`Could not look for other software: ${String(e)}`)
    }
  }, [])

  useEffect(() => {
    void scan()
  }, [scan])

  const run = async (source: string, paths: string[]) => {
    setBusy(source)
    try {
      const result = await importContent(paths, overwrite)
      setLast({ source, result })
      const { report, bibles } = result
      const changed =
        report.imported +
        report.updated +
        report.templates.length +
        bibles.filter((b) => b.status === "imported" || b.status === "updated")
          .length
      if (changed > 0) toast.success(`${source}: ${summarizeImport(result)}`)
      else if (report.failed.length > 0)
        toast.warning(`${source}: nothing could be imported`)
    } catch (e) {
      toast.error(`${source}: ${String(e)}`)
    } finally {
      setBusy(null)
    }
  }

  const pickFiles = async () => {
    const picked = await openDialog({
      multiple: true,
      directory: false,
      filters: [{ name: "Songs, services, Bibles", extensions: IMPORT_FILE_EXTENSIONS }],
    })
    const paths = picked === null ? [] : Array.isArray(picked) ? picked : [picked]
    if (paths.length > 0)
      await run(paths.length === 1 ? baseName(paths[0]) : `${paths.length} files`, paths)
  }

  const pickFolder = async () => {
    const picked = await openDialog({ multiple: false, directory: true })
    if (typeof picked === "string") await run(baseName(picked), [picked])
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium">Found on this computer</h3>
          <Button
            size="sm"
            variant="ghost"
            disabled={detected === null || busy !== null}
            onClick={() => void scan()}
            aria-label="Look again"
            title="Look again"
          >
            <RefreshCwIcon className="size-3.5" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Libraries from OpenLP, EasyWorship and ProPresenter in their usual
          places. Importing copies them into Manna; the other program is not
          changed.
        </p>
        {detected === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-3.5 animate-spin" /> Looking…
          </p>
        ) : detected.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
            Nothing found in the usual places. Choose files or a folder below.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {detected.map((d) => (
              <li
                key={`${d.kind}:${d.path}`}
                className="flex items-center gap-3 rounded-md border border-border p-3"
              >
                <LibraryIcon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{d.label}</div>
                  <div
                    className="truncate text-xs text-muted-foreground"
                    title={d.path}
                  >
                    {d.contents.join(" · ")} · {d.path}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => void run(d.label, [d.path])}
                  aria-label={`Import from ${d.label}`}
                >
                  {busy === d.label ? (
                    <Loader2Icon className="size-3.5 animate-spin" />
                  ) : (
                    "Import"
                  )}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Import from files</h3>
        <p className="text-xs text-muted-foreground">
          Choose exported files or a whole library folder. Manna works out what
          each one contains.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => void pickFiles()}
          >
            <FileUpIcon className="size-3.5" />
            Choose files…
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => void pickFolder()}
          >
            <FolderOpenIcon className="size-3.5" />
            Choose folder…
          </Button>
        </div>
        <div className="mt-1 overflow-hidden rounded-md border border-border">
          <div className="border-b border-border bg-muted/40 px-3 py-1.5 text-[0.625rem] font-semibold tracking-wider text-muted-foreground uppercase">
            Supported
          </div>
          <ul className="divide-y divide-border">
            {SUPPORTED.map((s) => (
              <li
                key={s.app}
                className="grid grid-cols-1 gap-0.5 px-3 py-2 sm:grid-cols-[9rem_1fr]"
              >
                <div className="text-xs font-medium">{s.app}</div>
                <div className="min-w-0">
                  <div className="text-xs">{s.brings}</div>
                  <div className="text-[0.625rem] text-muted-foreground">
                    {s.files}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Where things go</h3>
        <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
          <li>Songs appear in the Songs panel, marked with their source.</li>
          <li>
            Services, schedules, playlists and custom slides become service plan
            templates you can load into a session.
          </li>
          <li>Bibles are added to the translation list under Bible.</li>
        </ul>
      </section>

      <label className="flex items-start gap-3 rounded-md border border-border p-3">
        <Switch
          checked={overwrite}
          onCheckedChange={setOverwrite}
          disabled={busy !== null}
          className="mt-0.5"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">Replace earlier imports</span>
          <span className="text-xs text-muted-foreground">
            Off keeps songs, templates and Bibles you imported before, including
            any edits made in Manna. On replaces them with the source&apos;s
            current version.
          </span>
        </span>
      </label>

      {last && <ResultCard source={last.source} result={last.result} />}
    </div>
  )
}

function baseName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}
