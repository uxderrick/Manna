import { useEffect } from "react"
import { Workspace } from "@/components/layout/workspace"
import { useRemoteControl } from "@/hooks/use-remote-control"
import { hydrateSettings } from "@/stores"
import { Toaster } from "sonner"

export function App() {
  useRemoteControl()

  useEffect(() => {
    hydrateSettings()
  }, [])

  return (
    <>
      <Workspace />
      <Toaster position="top-right" />
    </>
  )
}

export default App
