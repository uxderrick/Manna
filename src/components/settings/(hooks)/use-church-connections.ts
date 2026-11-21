import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
export type ChurchConnections = { publishing: boolean; sms: boolean }
const DISCONNECTED: ChurchConnections = { publishing: false, sms: false }
/** Local configuration check only. Never contacts a website or SMS provider. */
export function useChurchConnections() {
  const [connections, setConnections] = useState(DISCONNECTED)
  useEffect(() => {
    let active = true
    void invoke<ChurchConnections>("get_church_connections").then(
      (value) => {
        if (active)
          setConnections({
            publishing: value?.publishing === true,
            sms: value?.sms === true,
          })
      },
      () => {
        if (active) setConnections(DISCONNECTED)
      }
    )
    return () => {
      active = false
    }
  }, [])
  return connections
}
