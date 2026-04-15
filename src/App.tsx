import { useEffect } from "react"
import { Workspace } from "@/components/layout/workspace"
import { useRemoteControl } from "@/hooks/use-remote-control"
import { hydrateSettings } from "@/stores"
import { ResumeSessionDialog } from "@/components/resume-session-dialog"
import { Toaster } from "sonner"

export function App() {
  useRemoteControl()

  useEffect(() => {
    hydrateSettings()
  }, [])

  return (
    <>
      <Workspace />
      <ResumeSessionDialog />
      <Toaster position="top-right" />
    </>
  )
}

export default App
