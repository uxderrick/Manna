import { useChurchConnections } from "@/components/settings/(hooks)/use-church-connections"
import {
  SermonAudioPanel,
  AudioUploadProgress,
} from "../(components)/sermon-audio-panel"
import type { AudioPublicationState } from "../(lib)/sermon-audio"
import { useState } from "react"
import {
  CopyIcon,
  LoaderIcon,
  RefreshCwIcon,
  SaveIcon,
  SparklesIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { SermonSummary } from "@/lib/summarize"
import { hasSermonContent } from "@/lib/summarize"
import { formatSermonSms } from "../(lib)/publication"
import type { useSharingDrafts } from "../(hooks)/use-sharing-drafts"
import { PublicationActions } from "../(components)/publication-actions"
import { RecapEditor } from "../(components)/recap-editor"
import { SmsAlternatives } from "../(components)/sms-alternatives"
import { SmsDraftEditor } from "../(components)/sms-draft-editor"

// Paused until sermon audio is ready to resume.
const sermonAudioEnabled = false

export function SharingTab({
  kind,
  sharing,
  summary,
  title,
  speaker,
  summarizing,
  startedAtMs,
}: {
  kind: "public-recap" | "sms"
  sharing: ReturnType<typeof useSharingDrafts>
  summary: SermonSummary | null
  title: string
  speaker?: string | null
  startedAtMs?: number
  summarizing: boolean
}) {
  const [audioState, setAudioState] = useState<AudioPublicationState>({
    mode: "excluded",
  })
  const connections = useChurchConnections()
  const [copyState, setCopyState] = useState("")
  const { draft, operation, error, dirty } = sharing
  const busy = operation !== "idle"
  const isSms = kind === "sms"
  const label = isSms ? "SMS" : "Public Recap"
  const hasDraft = Boolean(isSms ? draft.sms : draft.title || draft.recap)
  const canGenerate =
    !summarizing && (!isSms || Boolean(summary && hasSermonContent(summary)))
  const formattedSms = formatSermonSms(draft.sms)
  const words = draft.recap.trim() ? draft.recap.trim().split(/\s+/).length : 0
  const copy = async (kind: "recap" | "sms") => {
    try {
      await navigator.clipboard.writeText(
        kind === "sms" ? formattedSms : `${draft.title}\n\n${draft.recap}`
      )
      setCopyState(kind === "sms" ? "SMS copied" : "Recap copied")
    } catch {
      setCopyState("Could not copy. Select the text and copy it manually.")
    }
  }
  return (
    <div
      aria-label={label}
      className={`mx-auto flex w-full ${!isSms && sermonAudioEnabled ? "max-w-6xl" : "max-w-3xl"} min-w-0 flex-col gap-5 px-5 py-7 sm:px-8 sm:py-9`}
    >
      <div>
        <h2 className="text-base font-semibold tracking-tight">{label}</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {isSms
            ? connections.sms
              ? "Review your message, preview the cost, and send it to your saved contact list."
              : "Prepare a message to copy into your SMS service."
            : connections.publishing
              ? "Prepare and publish a short recap for your church."
              : "Prepare a recap to copy into your website or sharing service."}
        </p>
      </div>
      {operation === "loading" ? (
        <p role="status" className="text-xs text-muted-foreground">
          Loading drafts…
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!canGenerate || busy}
              onClick={() => {
                if (isSms) {
                  if (summary)
                    void sharing.generateSmsAlternatives(summary, title)
                } else void sharing.generate(title, speaker, "recap")
              }}
              title={
                !isSms && hasDraft
                  ? `Replaces the ${isSms ? "SMS" : "recap"} draft. Save or copy your edits first.`
                  : undefined
              }
            >
              {operation === "generating" ? (
                <LoaderIcon className="size-3.5 animate-spin" />
              ) : hasDraft ? (
                <RefreshCwIcon className="size-3.5" />
              ) : (
                <SparklesIcon className="size-3.5" />
              )}
              {operation === "generating"
                ? "Generating…"
                : isSms
                  ? sharing.smsAlternatives.length
                    ? "Generate new alternatives"
                    : "Generate 3 alternatives"
                  : hasDraft
                    ? `Regenerate ${isSms ? "SMS" : "recap"}`
                    : `Generate ${isSms ? "SMS" : "recap"}`}
            </Button>
            <Button
              size="sm"
              disabled={!dirty || busy}
              onClick={() => void sharing.save()}
            >
              {operation === "saving" ? (
                <LoaderIcon className="size-3.5 animate-spin" />
              ) : (
                <SaveIcon className="size-3.5" />
              )}{" "}
              Save changes
            </Button>
          </div>
          {isSms && !canGenerate && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Generate a summary with sermon teaching to create AI drafts. You
              can also write your own below.
            </p>
          )}
          {!isSms && (
            <div
              className={
                connections.publishing && sermonAudioEnabled
                  ? "grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]"
                  : "min-w-0"
              }
            >
              <section
                aria-label="Sermon recap draft"
                className="min-w-0 space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Sermon recap</h3>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!draft.recap}
                    onClick={() => void copy("recap")}
                  >
                    <CopyIcon className="size-3" />
                    Copy
                  </Button>
                </div>
                <label className="block space-y-1.5 text-xs font-medium">
                  Title
                  <Input
                    value={draft.title}
                    disabled={busy}
                    maxLength={200}
                    onChange={(event) =>
                      sharing.update("title", event.target.value)
                    }
                    placeholder="Sermon title"
                  />
                </label>
                <RecapEditor
                  value={draft.recap}
                  disabled={busy}
                  onChange={(value) => sharing.update("recap", value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  {words} words · Suggested length: 240–360
                </p>
                {connections.publishing && (
                  <PublicationActions
                    publication={sharing.publication}
                    disabled={
                      busy ||
                      (sermonAudioEnabled && audioState.mode === "busy") ||
                      !draft.title.trim() ||
                      !draft.recap.trim()
                    }
                    publishing={operation === "publishing"}
                    onPublish={() =>
                      void sharing.publish(
                        title,
                        speaker,
                        sermonAudioEnabled && audioState.mode === "included",
                        sermonAudioEnabled && audioState.mode === "included"
                          ? audioState.revision
                          : undefined
                      )
                    }
                  />
                )}
                {!connections.publishing && (
                  <p className="text-xs text-muted-foreground">
                    Copy the recap and paste it into your website or sharing
                    service.
                  </p>
                )}
              </section>
              {connections.publishing && sermonAudioEnabled && (
                <aside aria-label="Sermon audio" className="min-w-0 space-y-3">
                  <SermonAudioPanel
                    sessionId={sharing.sessionId}
                    startedAtMs={startedAtMs}
                    disabled={busy}
                    onChange={setAudioState}
                  />
                  {operation === "publishing" &&
                    audioState.mode === "included" && (
                      <AudioUploadProgress sessionId={sharing.sessionId} />
                    )}
                </aside>
              )}
            </div>
          )}
          {isSms && (
            <SmsAlternatives
              options={sharing.smsAlternatives}
              selectedMessage={formattedSms}
              disabled={busy}
              onSelect={(message) => sharing.update("sms", message)}
            />
          )}
          {isSms && (
            <SmsDraftEditor
              sharing={sharing}
              busy={busy}
              onCopy={() => void copy("sms")}
            />
          )}
          <p role="status" className="text-xs text-muted-foreground">
            {dirty
              ? "Unsaved changes"
              : hasDraft
                ? "Saved on this device"
                : "Drafts are saved on this device"}
          </p>
        </>
      )}
      {error && (
        <div role="alert" className="space-y-2 text-xs text-destructive">
          <p>{error}</p>
          {operation === "load-error" && (
            <Button size="sm" variant="outline" onClick={sharing.retry}>
              Try again
            </Button>
          )}
        </div>
      )}
      {copyState && (
        <p role="status" className="text-xs text-muted-foreground">
          {copyState}
        </p>
      )}
    </div>
  )
}
