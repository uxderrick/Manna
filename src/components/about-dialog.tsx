import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useAboutDialogStore } from "@/lib/about-dialog"
import { getVersion } from "@tauri-apps/api/app"
import { openUrl } from "@tauri-apps/plugin-opener"

export function AboutDialog() {
  const { isOpen, closeAbout } = useAboutDialogStore()
  const [version, setVersion] = useState("0.1.0")

  useEffect(() => {
    if (isOpen) {
      getVersion().then(setVersion).catch(() => {})
    }
  }, [isOpen])

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closeAbout()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-center text-xl">Manna</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2 text-sm">
          <p className="text-muted-foreground">Version {version}</p>

          <p className="text-center text-muted-foreground">
            Real-time AI Bible verse detection for worship
          </p>

          <div className="w-full space-y-2 rounded-lg bg-muted/50 p-3 text-xs">
            <p>
              <span className="font-medium">Credits:</span>{" "}
              Built on{" "}
              <button
                className="text-primary underline underline-offset-2"
                onClick={() => openUrl("https://github.com/openbezal/rhema")}
              >
                Rhema
              </button>{" "}
              by OpenBezal
            </p>
            <p>
              <span className="font-medium">Tech:</span>{" "}
              Tauri, React, Rust, Whisper, ONNX
            </p>
            <p>
              <span className="font-medium">License:</span> MIT
            </p>
          </div>

          <button
            className="text-xs text-primary underline underline-offset-2"
            onClick={() => openUrl("https://github.com/openbezal/rhema")}
          >
            View on GitHub
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
