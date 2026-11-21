/** Let the browser paint before expensive NDI pixel reads and encoding. */
export function afterBroadcastPaint(callback: () => void): () => void {
  if (
    typeof document !== "undefined" &&
    document.visibilityState === "hidden"
  ) {
    const timer = setTimeout(callback, 0)
    return () => clearTimeout(timer)
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const frame = requestAnimationFrame(() => {
    timer = setTimeout(callback, 0)
  })
  return () => {
    cancelAnimationFrame(frame)
    clearTimeout(timer)
  }
}
