import { useCallback } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useAudioStore } from "@/stores"
import { useTauriEvent } from "./use-tauri-event"
import type { DeviceInfo, AudioLevel } from "@/types"

export function useAudio() {
  const store = useAudioStore()

  // Listen for audio level events from Rust
  useTauriEvent<AudioLevel>("audio_level", (level) => {
    store.setLevel(level)
  })

  const loadDevices = useCallback(async () => {
    const devices = await invoke<DeviceInfo[]>("get_audio_devices")
    store.setDevices(devices)
    return devices
  }, [store])

  const startCapture = useCallback(
    async (deviceId?: string | null) => {
      await invoke("start_capture", {
        deviceId: deviceId ?? store.selectedDeviceId,
        gain: store.gain,
      })
      store.setCapturing(true)
    },
    [store]
  )

  const stopCapture = useCallback(async () => {
    await invoke("stop_capture")
    store.setCapturing(false)
    store.setLevel({ rms: 0, peak: 0 })
  }, [store])

  const setGain = useCallback(
    async (gain: number) => {
      await invoke("set_gain", { gain })
      store.setGain(gain)
    },
    [store]
  )

  return {
    ...store,
    loadDevices,
    startCapture,
    stopCapture,
    setGain,
  }
}
