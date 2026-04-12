/**
 * Downloads the NDI SDK libraries and headers from GitHub repositories.
 *
 * Sources:
 * - Headers + Windows DLL: TrueLazer (https://github.com/PolarAudio/TrueLazer)
 * - macOS dylib: KlakNDI (https://github.com/keijiro/KlakNDI)
 * - Linux so: KlakNDI (https://github.com/keijiro/KlakNDI)
 *
 * Run: bun run download:ndi-sdk
 */

import { join } from "node:path"
import { mkdir } from "node:fs/promises"

const SDK_DIR = join(import.meta.dir, "..", "sdk", "ndi")

const TRUELAZER_BASE =
  "https://raw.githubusercontent.com/PolarAudio/TrueLazer/main/sdk/NDI%206%20SDK"

const KLAKNDI_BASE =
  "https://github.com/keijiro/KlakNDI/raw/main/Packages/jp.keijiro.klak.ndi/Plugin"

// NDI header filenames (from TrueLazer Include/)
const HEADERS = [
  "Processing.NDI.DynamicLoad.h",
  "Processing.NDI.Find.h",
  "Processing.NDI.FrameSync.h",
  "Processing.NDI.Lib.cplusplus.h",
  "Processing.NDI.Lib.h",
  "Processing.NDI.Recv.ex.h",
  "Processing.NDI.Recv.h",
  "Processing.NDI.RecvAdvertiser.h",
  "Processing.NDI.RecvListener.h",
  "Processing.NDI.Routing.h",
  "Processing.NDI.Send.h",
  "Processing.NDI.compat.h",
  "Processing.NDI.deprecated.h",
  "Processing.NDI.structs.h",
  "Processing.NDI.utilities.h",
]

interface DownloadItem {
  url: string
  dest: string
  name: string
}

const downloads: DownloadItem[] = [
  // Headers from TrueLazer
  ...HEADERS.map((h) => ({
    url: `${TRUELAZER_BASE}/Include/${h}`,
    dest: join(SDK_DIR, "include", h),
    name: `Header: ${h}`,
  })),

  // Windows DLL from TrueLazer
  {
    url: `${TRUELAZER_BASE}/Bin/x64/Processing.NDI.Lib.x64.dll`,
    dest: join(SDK_DIR, "windows", "Processing.NDI.Lib.x64.dll"),
    name: "Windows: Processing.NDI.Lib.x64.dll",
  },

  // macOS dylib from KlakNDI
  {
    url: `${KLAKNDI_BASE}/macOS/libndi.dylib`,
    dest: join(SDK_DIR, "macos", "libndi.dylib"),
    name: "macOS: libndi.dylib",
  },

  // Linux so from KlakNDI
  {
    url: `${KLAKNDI_BASE}/Linux/libndi.so`,
    dest: join(SDK_DIR, "linux", "libndi.so"),
    name: "Linux: libndi.so",
  },
]

async function downloadFile(url: string, dest: string): Promise<void> {
  const response = await fetch(url, { redirect: "follow" })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`)
  }
  const buffer = await response.arrayBuffer()
  await Bun.write(dest, buffer)
}

async function main() {
  console.log("\n=== Downloading NDI SDK ===\n")

  // Create directories
  await mkdir(join(SDK_DIR, "include"), { recursive: true })
  await mkdir(join(SDK_DIR, "macos"), { recursive: true })
  await mkdir(join(SDK_DIR, "windows"), { recursive: true })
  await mkdir(join(SDK_DIR, "linux"), { recursive: true })

  let success = 0
  let failed = 0

  for (const item of downloads) {
    process.stdout.write(`  ${item.name}... `)
    try {
      await downloadFile(item.url, item.dest)
      const stat = Bun.file(item.dest)
      const size = stat.size
      console.log(
        `OK (${size > 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${(size / 1024).toFixed(1)} KB`})`
      )
      success++
    } catch (err) {
      console.log(`FAILED: ${err instanceof Error ? err.message : String(err)}`)
      failed++
    }
  }

  console.log(`\n=== Done: ${success} downloaded, ${failed} failed ===`)

  if (failed > 0) {
    console.log(
      "\nSome files failed to download. You may need to download them manually."
    )
    console.log("Sources:")
    console.log(
      "  TrueLazer: https://github.com/PolarAudio/TrueLazer/tree/main/sdk/NDI%206%20SDK"
    )
    console.log("  KlakNDI:   https://github.com/keijiro/KlakNDI")
  }

  console.log(`\nSDK directory: ${SDK_DIR}`)
}

main().catch((err) => {
  console.error("Download failed:", err)
  process.exit(1)
})
