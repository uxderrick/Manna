import { ConnectionOnly } from "@/components/settings/(components)/connection-only"
import { CopyIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { useSharingDrafts } from "../(hooks)/use-sharing-drafts"
import { formatSermonSms } from "../(lib)/publication"
import { smsMetrics } from "../(lib)/sharing-drafts"
import { SmsSendAction } from "./sms-send-action"
export function SmsDraftEditor({
  sharing,
  busy,
  onCopy,
}: {
  sharing: ReturnType<typeof useSharingDrafts>
  busy: boolean
  onCopy: () => void
}) {
  const { draft } = sharing
  const formattedSms = formatSermonSms(draft.sms)
  const metrics = smsMetrics(formattedSms)
  return (
    <section aria-label="SMS draft" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">SMS</h3>
        <Button
          size="sm"
          variant="ghost"
          disabled={!draft.sms}
          onClick={onCopy}
        >
          <CopyIcon className="size-3" />
          Copy
        </Button>
      </div>
      <label className="block space-y-1.5 text-xs font-medium">
        Message
        <textarea
          value={draft.sms}
          onBlur={() => {
            if (draft.sms !== formattedSms) sharing.update("sms", formattedSms)
          }}
          disabled={busy}
          maxLength={2000}
          onChange={(event) => sharing.update("sms", event.target.value)}
          placeholder="One takeaway to carry into the week…"
          className="min-h-28 w-full resize-y rounded-md border border-input bg-background p-3 text-sm leading-relaxed disabled:opacity-60"
        />
      </label>
      <p
        role="status"
        className={`text-xs ${metrics.segments > 1 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}
      >
        {metrics.units}/{metrics.limit} · {metrics.segments} SMS{" "}
        {metrics.segments === 1 ? "part" : "parts"} · {metrics.encoding}
      </p>
      {metrics.encoding === "Unicode" && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          This text uses Unicode. One SMS holds 70 units; emoji can use two
          units each.
        </p>
      )}
      {metrics.segments > 1 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Shorten this message to keep it in one SMS.
        </p>
      )}
      <ConnectionOnly kind="sms">
        <SmsSendAction
          sessionId={sharing.sessionId}
          message={formattedSms}
          disabled={busy || !draft.sms.trim()}
        />
      </ConnectionOnly>
      <p className="text-xs text-muted-foreground">
        Copy this message and paste it into your SMS service.
      </p>
    </section>
  )
}
