import { initializeChurchAssets } from "@/lib/church-assets"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"
import { hydrateCustomThemes } from "@/stores/broadcast-store"
import { useSongStore } from "@/stores/song-store"
import { maybeAutoCheckUpdates } from "@/hooks/use-updater"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { TooltipProvider } from "@/components/ui/tooltip.tsx"

// Suppress the webview's default right-click menu (Reload / Inspect Element).
// During a live service an accidental "Reload" click nukes queue and broadcast
// state. Reload is reachable only via View → Reload Window (intentionally no
// keyboard shortcut either). Inputs and contenteditable elements keep their
// native menu so paste / spellcheck still work.
window.addEventListener("contextmenu", (e) => {
  const target = e.target as HTMLElement | null
  const tag = target?.tagName
  const editable = target?.isContentEditable
  if (tag === "INPUT" || tag === "TEXTAREA" || editable) return
  e.preventDefault()
})

// Block Cmd+R / Ctrl+R / F5 — same rationale as the contextmenu handler.
// The webview ships these as default reload shortcuts; we override them here.
window.addEventListener("keydown", (e) => {
  const isReloadCombo =
    ((e.metaKey || e.ctrlKey) && (e.key === "r" || e.key === "R")) ||
    e.key === "F5"
  if (isReloadCombo) {
    e.preventDefault()
    e.stopPropagation()
  }
}, true)

void initializeChurchAssets().then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </ThemeProvider>
    </StrictMode>
  )

})

hydrateCustomThemes()
useSongStore.getState().hydrateSongs()
setTimeout(() => {
  void maybeAutoCheckUpdates()
}, 10_000)
