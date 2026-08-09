import { CheckIcon } from "lucide-react"
import { HIGHLIGHT_COLORS } from "@/lib/text-highlights"
import { persistDefaultHighlightColor, useSettingsStore } from "@/stores"
import { cn } from "@/lib/utils"

export function HighlightSettingsSection() {
  const selected = useSettingsStore((state) => state.defaultHighlightColor)

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium">Default passage highlight</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          This color is focused first when you select words in Program preview.
        </p>
      </div>
      <div className="flex flex-wrap gap-3" role="radiogroup" aria-label="Default passage highlight color">
        {HIGHLIGHT_COLORS.map((color) => {
          const active = selected === color
          return (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`Use ${color} as default highlight`}
              onClick={() => void persistDefaultHighlightColor(color)}
              className={cn(
                "grid size-10 place-items-center rounded-full border-2 transition-transform hover:scale-105",
                active ? "border-foreground" : "border-transparent",
              )}
              style={{ backgroundColor: color }}
            >
              {active ? <CheckIcon className="size-4 text-black/75" strokeWidth={3} /> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
