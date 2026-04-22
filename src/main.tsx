import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"
import { hydrateCustomThemes } from "@/stores/broadcast-store"
import { useSongStore } from "@/stores/song-store"
import { maybeAutoCheckUpdates } from "@/hooks/use-updater"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { TooltipProvider } from "@/components/ui/tooltip.tsx"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark">
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>
)

hydrateCustomThemes()
useSongStore.getState().hydrateSongs()
setTimeout(() => {
  void maybeAutoCheckUpdates()
}, 10_000)
