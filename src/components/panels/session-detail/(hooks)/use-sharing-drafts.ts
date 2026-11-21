import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useSettingsStore } from "@/stores"
import type { SermonSummary } from "@/lib/summarize"
import {
  attachSermonLink,
  canonicalSermonLinks,
  formatSermonSms,
  type SessionPublication,
} from "../(lib)/publication"
import {
  expandSessionSlides,
  type SavedSessionSlide,
} from "../(lib)/session-slides"
import { transcriptArtwork } from "../(lib)/transcript-presentation"
import { renderSlideJpeg } from "../(lib)/slide-download"
import {
  EMPTY_SHARING_DRAFT,
  parseSharingDraft,
  type SharingDraft,
  smsMetrics,
} from "../(lib)/sharing-drafts"

import {
  parseSmsAlternatives,
  type SmsAlternative,
} from "../(lib)/sms-alternatives"

export function useSharingDrafts(sessionId: number) {
  const [draft, setDraft] = useState<SharingDraft>(EMPTY_SHARING_DRAFT)
  const [smsAlternatives, setSmsAlternatives] = useState<SmsAlternative[]>([])
  const [saved, setSaved] = useState<SharingDraft>(EMPTY_SHARING_DRAFT)
  const [publication, setPublication] = useState<SessionPublication | null>(
    null
  )
  const [operation, setOperation] = useState<
    "loading" | "idle" | "generating" | "saving" | "publishing" | "load-error"
  >("loading")
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let cancelled = false
    Promise.all([
      invoke<SharingDraft | null>("get_sharing_draft", { sessionId }),
      invoke<SessionPublication | null>("get_session_publication", {
        sessionId,
      }),
    ])
      .then(([value, published]) => {
        if (cancelled) return
        const draft = value
          ? { ...value, sms: formatSermonSms(value.sms) }
          : EMPTY_SHARING_DRAFT
        setDraft(draft)
        setSaved(draft)
        setPublication(
          published?.url
            ? { ...published, url: canonicalSermonLinks(published.url) }
            : published
        )
        setOperation("idle")
      })
      .catch((reason) => {
        if (cancelled) return
        setError(`Could not load drafts: ${String(reason)}`)
        setOperation("load-error")
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, retry])

  const generate = async (
    title: string,
    speaker?: string | null,
    scope: "recap" | "sms" | "both" = "both"
  ) => {
    if (operation !== "idle") return
    const apiKey = useSettingsStore.getState().deepseekApiKey
    if (!apiKey) {
      setError("Add your DeepSeek API key in Settings → API Keys.")
      return
    }
    setOperation("generating")
    setError(null)
    try {
      const value = await invoke<SharingDraft>("generate_sharing_draft", {
        apiKey,
        sessionId,
        title,
        speaker: speaker ?? null,
        previousDraft: {
          title: draft.title,
          recap: scope === "sms" ? "" : draft.recap,
          sms: scope === "recap" ? "" : draft.sms,
        },
      })
      const next = parseSharingDraft(JSON.stringify(value))
      if (publication?.url && scope !== "recap") {
        const generated = await invoke<string>("generate_linked_sms", {
          apiKey,
          recap: scope === "sms" ? draft.recap || next.recap : next.recap,
          url: publication.url,
          previousSms: draft.sms,
        })
        next.sms = attachSermonLink(generated, publication.url)
        if (smsMetrics(next.sms).segments > 1)
          throw new Error("The SMS needs manual shortening.")
      }
      const sameText = (a: string, b: string) =>
        a.trim().replace(/\s+/g, " ") === b.trim().replace(/\s+/g, " ")
      const unchanged =
        scope === "sms"
          ? sameText(next.sms, draft.sms)
          : scope === "recap"
            ? sameText(next.recap, draft.recap)
            : sameText(next.sms, draft.sms) && sameText(next.recap, draft.recap)
      if (unchanged)
        throw new Error(
          "The AI returned the same wording. Your draft is unchanged. Try regenerating again."
        )
      setDraft((current) =>
        scope === "sms"
          ? { ...current, sms: next.sms }
          : scope === "recap"
            ? { ...current, title: next.title, recap: next.recap }
            : next
      )
    } catch (reason) {
      setError(`Could not generate drafts: ${String(reason)}`)
    } finally {
      setOperation("idle")
    }
  }
  const generateSmsAlternatives = async (
    summary: SermonSummary,
    title: string
  ) => {
    if (operation !== "idle") return
    const apiKey = useSettingsStore.getState().deepseekApiKey
    if (!apiKey) {
      setError("Add your DeepSeek API key in Settings → API Keys.")
      return
    }
    setOperation("generating")
    setError(null)
    try {
      const options = await invoke<unknown>("generate_sms_alternatives", {
        apiKey,
        summary: JSON.stringify(summary),
        recap: draft.recap,
        title,
        url: publication?.url ?? null,
        previousMessages: [
          draft.sms,
          ...smsAlternatives.map((option) => option.message),
        ].filter(Boolean),
      })
      setSmsAlternatives(parseSmsAlternatives(options))
    } catch (reason) {
      setError(`Could not generate SMS alternatives: ${String(reason)}`)
    } finally {
      setOperation("idle")
    }
  }
  const save = async () => {
    if (operation !== "idle") return
    setOperation("saving")
    setError(null)
    try {
      const next = { ...draft, sms: formatSermonSms(draft.sms) }
      await invoke("save_sharing_draft", { sessionId, draft: next })
      setDraft(next)
      setSaved(next)
    } catch (reason) {
      setError(`Could not save drafts: ${String(reason)}`)
    } finally {
      setOperation("idle")
    }
  }
  const publish = async (
    title: string,
    speaker?: string | null,
    includeAudio = false,
    audioRevision?: string
  ) => {
    if (operation !== "idle") return
    setOperation("publishing")
    setError(null)
    let published: SessionPublication
    try {
      await invoke("save_sharing_draft", { sessionId, draft })
      setSaved(draft)
      const rows = await invoke<SavedSessionSlide[]>("get_session_slides", {
        sessionId,
      })
      const artwork = transcriptArtwork(
        expandSessionSlides(rows),
        title,
        speaker ?? null
      )
      const bytes = await renderSlideJpeg(artwork)
      const encoded = btoa(
        Array.from(bytes, (byte) => String.fromCharCode(byte)).join("")
      )
      published = await invoke<SessionPublication>("publish_session_recap", {
        sessionId,
        artwork: `data:image/jpeg;base64,${encoded}`,
        includeAudio,
        audioRevision: audioRevision ?? null,
      })
      setPublication(published)
    } catch (reason) {
      setError(`Could not publish recap: ${String(reason)}`)
      setOperation("idle")
      return
    }
    const url = published.url!
    let sms = attachSermonLink(draft.sms, url)
    const apiKey = useSettingsStore.getState().deepseekApiKey
    if (apiKey) {
      try {
        const generated = await invoke<string>("generate_linked_sms", {
          apiKey,
          recap: draft.recap,
          url,
        })
        const formatted = attachSermonLink(generated, url)
        if (!generated.endsWith(url) || smsMetrics(formatted).segments > 1)
          throw new Error("SMS exceeds one part")
        sms = formatted
      } catch {
        setError(
          "Recap published. The link was added to your SMS; review its length before using it."
        )
      }
    }
    const next = { ...draft, sms }
    setDraft(next)
    try {
      await invoke("save_sharing_draft", { sessionId, draft: next })
      setSaved(next)
    } catch {
      setError(
        "Recap published, but the updated SMS could not be saved. Click Save drafts to retry."
      )
    } finally {
      setOperation("idle")
    }
  }
  return {
    sessionId,
    smsAlternatives,
    generateSmsAlternatives,
    draft,
    operation,
    error,
    publication,
    publish,
    dirty: JSON.stringify(draft) !== JSON.stringify(saved),
    update: (field: keyof SharingDraft, value: string) =>
      setDraft((current) => ({ ...current, [field]: value })),
    generate,
    save,
    retry: () => {
      setError(null)
      setOperation("loading")
      setRetry((value) => value + 1)
    },
  }
}
