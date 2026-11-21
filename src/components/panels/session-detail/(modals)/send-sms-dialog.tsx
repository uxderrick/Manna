import {
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useSmsSend } from "../(hooks)/use-sms-send"
import {
  canSubmitListSms,
  canStartAnotherListSms,
  listSmsStatus,
} from "../(lib)/list-sms"
import { smsMetrics } from "../(lib)/sharing-drafts"
import { SmsListProgress } from "../(components)/sms-list-progress"

export function SendSmsDialog({
  sessionId,
  message,
}: {
  sessionId: number
  message: string
}) {
  const sms = useSmsSend(sessionId)
  const batch = sms.batch
  const metrics = smsMetrics(batch?.message ?? message)
  const busy = !["idle", "load-error"].includes(sms.mode)
  const submitting = sms.mode === "sending"
  const messageFits = smsMetrics(message).segments === 1
  const canPreview =
    sms.settings?.configured &&
    sms.settings.contactListId &&
    messageFits &&
    !batch &&
    sms.mode === "idle"
  return (
    <DialogContent
      className="flex max-h-[85vh] flex-col gap-4 overflow-hidden sm:max-w-lg"
      showCloseButton={!submitting}
      onEscapeKeyDown={(event) => {
        if (submitting) event.preventDefault()
      }}
      onInteractOutside={(event) => event.preventDefault()}
    >
      <DialogHeader>
        <DialogTitle>Send SMS</DialogTitle>
        <DialogDescription>
          Review your message and cost before sending to your saved contact
          list.
        </DialogDescription>
      </DialogHeader>
      <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
        {sms.mode === "loading" ? (
          <p role="status">Loading SMS settings and progress…</p>
        ) : (
          <>
            {!sms.settings?.configured && (
              <p className="rounded-md bg-muted p-3 text-sm">
                Add Comms360 in Settings → API Keys, then reopen this window.
              </p>
            )}
            <section aria-label="SMS message preview" className="space-y-2">
              <div className="flex justify-between gap-3 text-xs text-muted-foreground">
                <span>
                  From{" "}
                  {batch?.senderId ||
                    sms.settings?.senderId ||
                    "your sender ID"}
                </span>
                <span>
                  {metrics.units}/{metrics.limit} · {metrics.encoding}
                </span>
              </div>
              <p className="rounded-xl border border-border bg-muted/40 p-4 text-sm leading-relaxed break-words whitespace-pre-wrap">
                {batch?.message ?? message}
              </p>
              {metrics.segments !== 1 && !batch?.providerId && (
                <p role="alert" className="text-xs text-destructive">
                  Shorten the message to one SMS part in the SMS panel first.
                </p>
              )}
            </section>
            {batch && canStartAnotherListSms(batch) && !messageFits && (
              <p role="alert" className="text-xs text-destructive">
                Shorten your current SMS draft to one part before starting
                another message.
              </p>
            )}
            <section aria-label="SMS contact list" className="space-y-1">
              <h3 className="text-xs font-medium">Saved contact list</h3>
              <p className="text-xs break-all text-muted-foreground">
                {batch?.contactListId ??
                  sms.settings?.contactListId ??
                  "Not configured"}
              </p>
            </section>
            {batch && (
              <>
                <section
                  aria-label="SMS cost preview"
                  className="rounded-xl border border-border p-4"
                >
                  <dl className="grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Recipients
                      </dt>
                      <dd className="mt-1 font-medium">
                        {batch.recipientCount}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Total SMS parts
                      </dt>
                      <dd className="mt-1 font-medium">{batch.totalParts}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Estimated cost
                      </dt>
                      <dd className="mt-1 font-medium">
                        {batch.estimatedCost.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 4,
                        })}{" "}
                        {batch.currency}
                      </dd>
                    </div>
                  </dl>
                </section>
                <p role="status" className="text-sm font-medium">
                  {listSmsStatus(batch.status)}
                </p>
                {batch.providerId ? (
                  <SmsListProgress send={batch} />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {batch.status === "UNKNOWN"
                      ? "Submission is uncertain. Retry this saved submission; do not start another send."
                      : "No messages have been sent from this preview."}
                  </p>
                )}
                {batch.error && (
                  <p role="alert" className="text-sm text-destructive">
                    {batch.error}
                  </p>
                )}
              </>
            )}
            {sms.error && (
              <p role="alert" className="text-sm text-destructive">
                {sms.error}
              </p>
            )}
          </>
        )}
      </div>
      <DialogFooter className="shrink-0 flex-wrap gap-2">
        {batch ? (
          <>
            {!batch.providerId && batch.status !== "UNKNOWN" && (
              <Button variant="ghost" disabled={busy} onClick={sms.reset}>
                New preview
              </Button>
            )}
            {canStartAnotherListSms(batch) && (
              <Button
                variant="outline"
                disabled={busy || !messageFits}
                onClick={() => void sms.preview(message, batch.id)}
              >
                {sms.mode === "previewing"
                  ? "Checking cost…"
                  : "Send another message"}
              </Button>
            )}
            {batch.providerId && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void sms.refresh()}
              >
                {sms.mode === "refreshing" ? "Updating…" : "Refresh progress"}
              </Button>
            )}
            {canSubmitListSms(batch) && (
              <Button disabled={busy} onClick={() => void sms.send()}>
                {submitting
                  ? "Sending…"
                  : batch.status === "UNKNOWN"
                    ? "Retry submission"
                    : "Send SMS"}
              </Button>
            )}
          </>
        ) : (
          <Button
            disabled={!canPreview || busy}
            onClick={() => void sms.preview(message)}
          >
            {sms.mode === "previewing" ? "Checking cost…" : "Preview cost"}
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  )
}
