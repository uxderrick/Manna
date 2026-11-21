export interface ListSms {
  id: string
  sessionId: number
  message: string
  senderId: string
  contactListId: string
  createdAt: number
  recipientCount: number
  totalParts: number
  estimatedCost: number
  currency: string
  status: string
  providerId: string | null
  totalSent: number
  totalFailed: number
  delivered: number | null
  error: string | null
}
export function canSubmitListSms(send: Pick<ListSms, "status" | "providerId">) {
  return (
    !send.providerId &&
    (send.status === "PREVIEWED" || send.status === "UNKNOWN")
  )
}
export function needsListSmsProgress(
  send: Pick<
    ListSms,
    "providerId" | "status" | "recipientCount" | "delivered" | "totalFailed"
  >
) {
  if (!send.providerId || ["FAILED", "CANCELLED"].includes(send.status))
    return false
  return (
    send.status !== "COMPLETED" ||
    send.delivered === null ||
    send.delivered + send.totalFailed < send.recipientCount
  )
}
export function listSmsStatus(status: string) {
  return (
    (
      {
        PREVIEWED: "Ready to send",
        UNKNOWN: "Checking submission needed",
        REJECTED: "Not sent",
        PENDING: "Queued",
        QUEUED: "Queued",
        PROCESSING: "Sending",
        COMPLETED: "Sending complete",
        FAILED: "Failed",
        CANCELLED: "Cancelled",
        ACCEPTED: "Accepted",
        PAUSED: "Paused",
      } as Record<string, string>
    )[status] ?? status
  )
}

export function canStartAnotherListSms(
  send: Pick<ListSms, "status" | "providerId">
) {
  return Boolean(send.providerId) && send.status !== "UNKNOWN"
}
