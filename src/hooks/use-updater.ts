import { check } from "@tauri-apps/plugin-updater"
import { relaunch } from "@tauri-apps/plugin-process"

export async function checkForUpdates(manual: boolean): Promise<void> {
  try {
    const update = await check()
    if (update?.available) {
      // v1: same confirm dialog for both auto-check and manual-click paths.
      // Fancier toast-with-action pattern deferred to v1.1.
      const accept = window.confirm(
        `Update ${update.version} available.\n\n${update.body ?? ""}\n\nDownload and restart?`,
      )
      if (accept) {
        await update.downloadAndInstall()
        await relaunch()
      }
    } else if (manual) {
      window.alert("You're on the latest version.")
    }
  } catch (e) {
    if (manual) window.alert(`Update check failed: ${e}`)
    else console.warn("[updater] check failed:", e)
  }
}

/** Auto-check debounced to once per 24 hours via localStorage. */
export async function maybeAutoCheckUpdates(): Promise<void> {
  const KEY = "manna.lastUpdateCheck"
  const DAY_MS = 24 * 60 * 60 * 1000
  try {
    const last = parseInt(localStorage.getItem(KEY) ?? "0", 10)
    if (Date.now() - last < DAY_MS) return
    localStorage.setItem(KEY, String(Date.now()))
    await checkForUpdates(false)
  } catch {
    /* ignore */
  }
}
