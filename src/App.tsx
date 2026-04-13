import { Workspace } from "@/components/layout/workspace"
import { useRemoteControl } from "@/hooks/use-remote-control"
import { TutorialOverlay } from "@/components/tutorial/tutorial-overlay"
import { WelcomeDialog } from "@/components/welcome-dialog"
import { Toaster } from "sonner"

export function App() {
  useRemoteControl()
  return (
    <>
      <Workspace />
      <WelcomeDialog />
      <TutorialOverlay />
      <Toaster position="top-right" />
    </>
  )
}

export default App
