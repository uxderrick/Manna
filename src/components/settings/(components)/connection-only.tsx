import type { ReactNode } from "react"
import { useChurchConnections } from "../(hooks)/use-church-connections"
/** Optional church integrations stay hidden until configured on this device. */
export function ConnectionOnly({
  kind,
  children,
}: {
  kind: "publishing" | "sms" | "either"
  children: ReactNode
}) {
  const connections = useChurchConnections()
  const connected =
    kind === "either"
      ? connections.publishing || connections.sms
      : connections[kind]
  return connected ? children : null
}
