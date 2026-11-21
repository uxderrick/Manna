import { useCallback, useEffect, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import type { CommsSettings } from "../(lib)/sms-send"
import { needsListSmsProgress, type ListSms } from "../(lib)/list-sms"

type Mode =
  | "loading"
  | "idle"
  | "previewing"
  | "sending"
  | "refreshing"
  | "load-error"
export function useSmsSend(sessionId: number) {
  const [mode, setMode] = useState<Mode>("loading")
  const [settings, setSettings] = useState<CommsSettings | null>(null)
  const [batch, setBatch] = useState<ListSms | null>(null)
  const [error, setError] = useState("")
  const mounted = useRef(true)
  const inFlight = useRef(false)
  const pollUntil = useRef(0)
  const sendId = batch?.id
  useEffect(() => {
    let cancelled = false
    mounted.current = true
    Promise.all([
      invoke<CommsSettings>("get_comms360_settings"),
      invoke<ListSms | null>("get_contact_list_sms", { sessionId }),
    ])
      .then(([config, previous]) => {
        if (cancelled) return
        setSettings(config)
        setBatch(previous)
        pollUntil.current = Date.now() + 120000
        setMode("idle")
      })
      .catch((reason) => {
        if (cancelled) return
        setError(String(reason))
        setMode("load-error")
      })
    return () => {
      cancelled = true
      mounted.current = false
    }
  }, [sessionId])
  const preview = async (message: string, previousSendId?: string) => {
    if (inFlight.current) return
    inFlight.current = true
    setError("")
    setMode("previewing")
    try {
      const value = await invoke<ListSms>("preview_contact_list_sms", {
        sessionId,
        message,
        previousSendId: previousSendId ?? null,
      })
      if (mounted.current) setBatch(value)
    } catch (reason) {
      if (mounted.current) setError(String(reason))
    } finally {
      inFlight.current = false
      if (mounted.current) setMode("idle")
    }
  }
  const update = useCallback(
    async (action: "send" | "refresh") => {
      if (!sendId || inFlight.current) return
      inFlight.current = true
      setError("")
      setMode(action === "send" ? "sending" : "refreshing")
      try {
        const value = await invoke<ListSms>(
          action === "send"
            ? "send_contact_list_sms"
            : "refresh_contact_list_sms",
          { sessionId, sendId }
        )
        if (!mounted.current) return
        setBatch(value)
        if (action === "send") pollUntil.current = Date.now() + 120000
      } catch (reason) {
        if (!mounted.current) return
        setError(String(reason))
        try {
          const saved = await invoke<ListSms | null>("get_contact_list_sms", {
            sessionId,
          })
          if (mounted.current) setBatch(saved)
        } catch {
          /* Keep the existing send reference. */
        }
      } finally {
        inFlight.current = false
        if (mounted.current) setMode("idle")
      }
    },
    [sessionId, sendId]
  )
  useEffect(() => {
    if (
      mode !== "idle" ||
      error ||
      !batch ||
      !needsListSmsProgress(batch) ||
      Date.now() >= pollUntil.current
    )
      return
    const timer = setTimeout(() => {
      void update("refresh")
    }, 8000)
    return () => clearTimeout(timer)
  }, [batch, mode, error, update])
  return {
    mode,
    settings,
    batch,
    error,
    preview,
    send: () => update("send"),
    refresh: () => update("refresh"),
    reset: () => {
      setBatch(null)
      setError("")
    },
  }
}
