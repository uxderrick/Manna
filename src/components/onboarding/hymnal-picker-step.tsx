import { useState } from "react"
import { Button } from "@/components/ui/button"
import { HYMNAL_NAMES, HYMNAL_SOURCES } from "@/types"
import type { HymnalSource } from "@/types"

const HYMN_COUNTS: Record<HymnalSource, number> = {
  ghs: 260,
  mhb: 981,
  sankey: 1200,
  sda: 695,
}

export function HymnalPickerStep({
  onContinue,
}: {
  onContinue: (enabled: string[]) => void | Promise<void>
}) {
  const [enabled, setEnabled] = useState<Set<string>>(new Set(HYMNAL_SOURCES))
  const [submitting, setSubmitting] = useState(false)

  const toggle = (id: string) => {
    setEnabled((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const total = Array.from(enabled).reduce(
    (sum, id) => sum + (HYMN_COUNTS[id as HymnalSource] ?? 0),
    0,
  )

  const handleContinue = async () => {
    setSubmitting(true)
    try {
      await onContinue(Array.from(enabled))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Pick your hymnals</h2>
        <p className="text-sm text-muted-foreground">
          You can change these later in Settings.
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {HYMNAL_SOURCES.map((id) => (
          <li
            key={id}
            className="flex items-center gap-3 rounded-md border border-border p-3"
          >
            <input
              type="checkbox"
              id={`hymnal-${id}`}
              checked={enabled.has(id)}
              onChange={() => toggle(id)}
              className="size-4"
            />
            <label htmlFor={`hymnal-${id}`} className="flex-1 cursor-pointer">
              <div className="font-medium">{HYMNAL_NAMES[id]}</div>
              <div className="text-xs text-muted-foreground">
                {HYMN_COUNTS[id].toLocaleString()} hymns
              </div>
            </label>
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between border-t border-border pt-3 text-sm">
        <span className="text-muted-foreground">
          Total: {total.toLocaleString()} hymns
        </span>
        <Button onClick={handleContinue} disabled={submitting}>
          {submitting ? "Loading…" : "Continue"}
        </Button>
      </div>
    </div>
  )
}
