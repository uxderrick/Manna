import {
  loadYouTubeLinks,
  parseYouTubeLink,
  saveYouTubeLinks,
} from "@/lib/youtube"
import { useEffect, useMemo, useState } from "react"
import { invoke, convertFileSrc } from "@tauri-apps/api/core"
import { open as openDialog, ask } from "@tauri-apps/plugin-dialog"
import { useSettingsStore, useQueueStore } from "@/stores"
import { persistLocalImageFolder } from "@/stores/settings-store"
import { useServicePlan } from "@/hooks/use-service-plan"
import { validateVideo } from "@/lib/looping-video"
import {
  BUILTIN_LOOPS,
  youtubeMedia,
  isVideoPath,
  type MediaHit,
  type Tab,
  type Provider,
  type OnlineFilter,
} from "../(lib)/media"

export function useMediaLibrary() {
  const [tab, setTab] = useState<Tab>("local")
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<MediaHit[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [onlineFilter, setOnlineFilter] = useState<OnlineFilter>("all")
  const [libraryDir, setLibraryDir] = useState<string | null>(null)
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    invoke<string>("library_dir_path")
      .then(setLibraryDir)
      .catch(() => setLibraryDir(null))
  }, [])

  const pexelsKey = useSettingsStore((s) => s.pexelsApiKey)
  const unsplashKey = useSettingsStore((s) => s.unsplashApiKey)
  const braveKey = useSettingsStore((s) => s.braveApiKey)
  const localFolder = useSettingsStore((s) => s.localImageFolder)

  const presentImageLive = useQueueStore((s) => s.presentImageLive)
  const enqueueImage = useQueueStore((s) => s.enqueueImage)
  const { addItem: addPlanItem } = useServicePlan()

  const search = async (forceLocal = false) => {
    const sourceTab = forceLocal ? "local" : tab
    const searchQuery = forceLocal ? "" : query
    setError(null)
    setLoading(true)
    try {
      if (sourceTab === "online") {
        // Run any configured provider in parallel, interleave the results
        // round-robin so each source surfaces near the top of the grid.
        const calls: Array<Promise<MediaHit[]>> = []
        if (pexelsKey) {
          calls.push(
            invoke<MediaHit[]>("search_pexels", {
              apiKey: pexelsKey,
              query,
              page: 1,
            }).catch(() => [])
          )
        }
        if (unsplashKey) {
          calls.push(
            invoke<MediaHit[]>("search_unsplash", {
              apiKey: unsplashKey,
              query,
              page: 1,
            }).catch(() => [])
          )
        }
        if (braveKey) {
          calls.push(
            invoke<MediaHit[]>("search_brave_images", {
              apiKey: braveKey,
              query,
            }).catch(() => [])
          )
        }
        if (calls.length === 0) {
          setHits([])
          setError(
            "Add a Pexels, Unsplash, or Brave key in Settings → API Keys."
          )
          return
        }
        const results = await Promise.all(calls)
        const merged: MediaHit[] = []
        const len = Math.max(...results.map((r) => r.length))
        for (let i = 0; i < len; i++) {
          for (const r of results) {
            if (r[i]) merged.push(r[i])
          }
        }
        setHits(merged)
      } else {
        // Merge library (saved-from-online) + user folder hits. Library first
        // so freshly saved images surface near the top.
        const calls: Array<Promise<MediaHit[]>> = []
        calls.push(invoke<MediaHit[]>("list_library_images").catch(() => []))
        if (localFolder) {
          calls.push(
            invoke<MediaHit[]>("list_local_images", {
              folder: localFolder,
            }).catch(() => [])
          )
        }
        const [libHits, folderHits = []] = await Promise.all(calls)

        const libDir = libraryDir
        const withAssetUrls: MediaHit[] = [
          ...loadYouTubeLinks().map(youtubeMedia),
          ...BUILTIN_LOOPS,
          ...libHits.map((h) => ({
            ...h,
            localPath: h.url,
            ...(isVideoPath(h.url) ? { mediaType: "video" as const } : {}),
            url: convertFileSrc(h.url),
            thumbnailUrl: convertFileSrc(h.thumbnailUrl),
            validationFolder: libDir ?? undefined,
            provider: "library" as Provider,
          })),
          ...folderHits.map((h) => ({
            ...h,
            localPath: h.url,
            ...(isVideoPath(h.url) ? { mediaType: "video" as const } : {}),
            url: convertFileSrc(h.url),
            thumbnailUrl: convertFileSrc(h.thumbnailUrl),
            validationFolder: localFolder ?? undefined,
          })),
        ]

        const q = searchQuery.trim().toLowerCase()
        setHits(
          q
            ? withAssetUrls.filter((h) => h.label.toLowerCase().includes(q))
            : withAssetUrls
        )
      }
    } catch (e) {
      setError(
        typeof e === "string" ? e : e instanceof Error ? e.message : String(e)
      )
      setHits([])
    } finally {
      setLoading(false)
    }
  }

  // Auto-refresh local folder on mount + when folder changes
  useEffect(() => {
    if (tab === "local") {
      void search()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, localFolder])

  // Debounced search for online tab
  useEffect(() => {
    if (tab !== "online") return
    if (!query.trim()) return
    const t = setTimeout(() => void search(), 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, tab])

  const placeholder = useMemo(() => {
    if (tab === "local") return "Filter media…"
    return "Search images…"
  }, [tab])

  const pickFolder = async () => {
    const path = await openDialog({ directory: true, multiple: false })
    if (typeof path === "string") {
      await persistLocalImageFolder(path)
    }
  }

  const clearFolder = async () => {
    await persistLocalImageFolder(null)
  }

  const pickSingleFile = async () => {
    const file = await openDialog({
      directory: false,
      multiple: false,
      filters: [
        {
          name: "Images and videos",
          extensions: [
            "png",
            "jpg",
            "jpeg",
            "gif",
            "webp",
            "bmp",
            "tif",
            "tiff",
            "avif",
            "heic",
            "heif",
            "svg",
            "ico",
            "jfif",
            "apng",
            "mp4",
            "m4v",
            "mov",
            "webm",
          ],
        },
      ],
    })
    if (typeof file !== "string") return
    // Copy the picked file into the managed library so it persists across
    // reloads (previously the transient asset URL was lost on reload). It then
    // surfaces via list_library_images with a proper asset URL + validation
    // folder, so just refresh the local tab.
    setLoading(true)
    setError(null)
    try {
      if (isVideoPath(file)) await validateVideo(convertFileSrc(file))
      await invoke("import_library_image", { srcPath: file })
    } catch (e) {
      setError(
        typeof e === "string"
          ? e
          : e instanceof Error
            ? e.message
            : "Failed to import media"
      )
      return
    } finally {
      setLoading(false)
    }
    await search()
  }

  const resolveBroadcastUrl = async (hit: MediaHit): Promise<string> => {
    // Local images: broadcast window can't reliably fetch asset:// URLs from
    // a sibling webview, so embed the bytes as a data URL the projector renders directly.
    if (hit.mediaType === "youtube") {
      if (!parseYouTubeLink(hit.url)) throw new Error("Invalid YouTube link.")
      return hit.url
    }
    if (hit.mediaType === "video") {
      await validateVideo(hit.url)
      return hit.url
    }
    const folder = hit.validationFolder ?? localFolder
    if (hit.provider === "local" && hit.localPath && folder) {
      try {
        return await invoke<string>("read_local_image_data_url", {
          path: hit.localPath,
          folder,
        })
      } catch (e) {
        console.error("[images] data-url read failed", e)
        return hit.url
      }
    }
    return hit.url
  }

  const onGoLive = async (hit: MediaHit) => {
    if (hit.mediaType === "youtube") {
      const ndi = await invoke<{ active: boolean } | null>("get_ndi_status", {
        outputId: "main",
      })
      if (ndi?.active)
        throw new Error(
          "YouTube needs a projector or HDMI output. Stop NDI before playing it."
        )
    }
    const url = await resolveBroadcastUrl(hit)
    presentImageLive({
      url,
      label: hit.label,
      thumbnailUrl:
        hit.thumbnailUrl !== hit.url
          ? hit.thumbnailUrl
          : hit.mediaType
            ? undefined
            : hit.thumbnailUrl,
      ...(hit.mediaType ? { mediaType: hit.mediaType } : {}),
      provider: hit.provider,
    })
  }

  const onEnqueue = async (hit: MediaHit) => {
    const url = await resolveBroadcastUrl(hit)
    enqueueImage({
      url,
      label: hit.label,
      thumbnailUrl:
        hit.thumbnailUrl !== hit.url
          ? hit.thumbnailUrl
          : hit.mediaType
            ? undefined
            : hit.thumbnailUrl,
      ...(hit.mediaType ? { mediaType: hit.mediaType } : {}),
      provider: hit.provider,
    })
  }

  const onDownload = async (hit: MediaHit) => {
    if (hit.provider === "local" || hit.provider === "library") return
    try {
      await invoke<MediaHit>("save_image_to_library", {
        url: hit.url,
        label: hit.label || `Image from ${hit.provider}`,
        provider: hit.provider,
        photographer: hit.photographer,
        photographerUrl: hit.photographerUrl,
      })
      setSavedIds((prev) => new Set(prev).add(hit.id))
    } catch (e) {
      setError(
        typeof e === "string" ? e : e instanceof Error ? e.message : String(e)
      )
    }
  }

  const onDelete = async (hit: MediaHit) => {
    if (hit.mediaType === "youtube") {
      saveYouTubeLinks(
        loadYouTubeLinks().filter((link) => link.url !== hit.url)
      )
      setHits((previous) => previous.filter((item) => item.id !== hit.id))
      return
    }
    const folder = hit.validationFolder ?? localFolder
    if (!hit.localPath || !folder) return
    const ok = await ask(
      `Delete "${hit.label}" from disk? This cannot be undone.`,
      {
        title: "Delete media",
        kind: "warning",
      }
    )
    if (!ok) return
    try {
      if (hit.provider === "library") {
        await invoke("delete_library_image", { path: hit.localPath })
      } else {
        await invoke("delete_local_image", {
          path: hit.localPath,
          folder,
        })
      }
      setHits((prev) => prev.filter((h) => h.id !== hit.id))
    } catch (e) {
      setError(
        typeof e === "string" ? e : e instanceof Error ? e.message : String(e)
      )
    }
  }

  const onAddToPlan = async (hit: MediaHit) => {
    const url = await resolveBroadcastUrl(hit)
    await addPlanItem("blank", {
      type: "blank",
      showLogo: false,
      imageUrl: url,
      imageLabel: hit.label,
      ...(hit.mediaType
        ? {
            mediaType: hit.mediaType,
            poster: hit.thumbnailUrl !== hit.url ? hit.thumbnailUrl : undefined,
          }
        : {}),
    })
  }

  const addYouTube = async (url: string, label: string) => {
    const link = parseYouTubeLink(url, label)
    if (!link) throw new Error("Paste a valid YouTube video link.")
    saveYouTubeLinks([
      link,
      ...loadYouTubeLinks().filter((saved) => saved.videoId !== link.videoId),
    ])
    setTab("local")
    setQuery("")
    await search(true)
  }

  const run = (action: () => Promise<void>) => {
    setError(null)
    void action().catch((error: unknown) =>
      setError(error instanceof Error ? error.message : String(error))
    )
  }

  return {
    addYouTube,
    placeholder,
    tab,
    setTab,
    query,
    setQuery,
    hits,
    loading,
    error,
    onlineFilter,
    setOnlineFilter,
    savedIds,
    pexelsKey,
    unsplashKey,
    braveKey,
    localFolder,
    search,
    pickFolder,
    clearFolder,
    pickSingleFile,
    onGoLive,
    onEnqueue,
    onAddToPlan,
    onDownload,
    onDelete,
    run,
  }
}
