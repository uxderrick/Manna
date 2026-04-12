import { useEffect } from "react"
import { listen } from "@tauri-apps/api/event"
import type { AppCommand } from "@/lib/command-registry"

/**
 * Listens for native Tauri menu events and dispatches them
 * to the matching command in the registry.
 */
export function useMenuEvents(commands: AppCommand[]) {
  useEffect(() => {
    const unlisten = listen<string>("menu-event", (event) => {
      const id = typeof event.payload === "string" ? event.payload : (event.payload as { id?: string })?.id
      if (!id) return

      const command = commands.find((cmd) => cmd.id === id)
      if (!command) return

      const isEnabled = command.enabled ? command.enabled() : true
      if (isEnabled) {
        command.execute()
      }
    })

    return () => {
      unlisten.then((fn) => fn())
    }
  }, [commands])
}
