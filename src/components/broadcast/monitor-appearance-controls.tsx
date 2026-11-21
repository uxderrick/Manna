import { useState } from "react"
import { CheckIcon, ChevronDownIcon } from "lucide-react"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useBibleStore } from "@/stores/bible-store"
import { switchTranslation } from "@/lib/switch-translation"
import { CanvasVerse } from "@/components/ui/canvas-verse"
import { BackgroundPicker } from "./background-picker"

const THEME_SAMPLE_VERSE = {
  reference: "Psalm 23:1",
  segments: [{ text: "The Lord is my shepherd" }],
}

export function MonitorAppearanceControls() {
  const themes = useBroadcastStore((state) => state.themes)
  const activeThemeId = useBroadcastStore((state) => state.activeThemeId)
  const setActiveTheme = useBroadcastStore((state) => state.setActiveTheme)
  const translations = useBibleStore((state) => state.translations)
  const activeTranslationId = useBibleStore(
    (state) => state.activeTranslationId
  )
  const activeTheme =
    themes.find((theme) => theme.id === activeThemeId) ?? themes[0]
  return (
    <>
      <div className="space-y-2">
        <span className="text-[10px] font-semibold tracking-widest text-white/40 uppercase">
          Background
        </span>
        <div className="flex gap-2">
          <BackgroundPicker context="scripture" />
          <BackgroundPicker context="song" />
        </div>
      </div>
      {/* Theme selector — accordion */}
      <AccordionSection title="Theme" subtitle={activeTheme?.name}>
        <div className="grid grid-cols-3 gap-2">
          {themes.map((t) => {
            const isActive = t.id === activeThemeId
            return (
              <button
                key={t.id}
                onClick={() => setActiveTheme(t.id)}
                className={`group relative flex flex-col items-center justify-center overflow-hidden rounded-md bg-black transition-all ${
                  isActive
                    ? "shadow-[0_0_8px_rgba(61,107,79,0.4)] ring-2 ring-primary"
                    : "ring-1 ring-white/[0.08] hover:ring-white/20"
                }`}
                aria-label={`Use ${t.name} theme`}
              >
                <CanvasVerse
                  theme={t}
                  verse={THEME_SAMPLE_VERSE}
                  className="pointer-events-none"
                />
                <div className="w-full bg-black/70 px-1 py-1">
                  <span className="text-[5px] font-medium text-white/80">
                    {t.name}
                  </span>
                </div>
                {isActive && (
                  <div className="absolute top-0.5 right-0.5 flex size-3 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <CheckIcon className="size-2" strokeWidth={3} />
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </AccordionSection>

      {/* Translation toggle — accordion */}
      <AccordionSection
        title="Translation"
        subtitle={
          translations.find((t) => t.id === activeTranslationId)?.abbreviation
        }
        defaultOpen
      >
        <div className="flex flex-wrap gap-1.5">
          {translations.slice(0, 7).map((t) => (
            <button
              key={t.id}
              onClick={() => switchTranslation(t.id)}
              className={`rounded-full px-3 py-1.5 text-[10px] font-semibold transition-all ${
                t.id === activeTranslationId
                  ? "bg-primary text-primary-foreground shadow-[0_0_8px_rgba(61,107,79,0.3)]"
                  : "bg-white/[0.04] text-white/35 ring-1 ring-white/[0.06] hover:bg-white/[0.08] hover:text-white/60"
              }`}
            >
              {t.abbreviation}
            </button>
          ))}
        </div>
      </AccordionSection>
    </>
  )
}

function AccordionSection({
  title,
  subtitle,
  children,
  defaultOpen = false,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="overflow-hidden rounded-lg bg-white/[0.02] ring-1 ring-white/[0.06]">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-3 py-2 transition-colors hover:bg-white/[0.04]"
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold tracking-widest text-white/40 uppercase">
            {title}
          </span>
          {subtitle && !open && (
            <span className="text-[10px] font-medium text-white/60">
              {subtitle}
            </span>
          )}
        </div>
        <ChevronDownIcon
          className={`size-3 text-white/25 transition-transform ${open ? "" : "-rotate-90"}`}
        />
      </button>
      {open && <div className="px-3 pt-1.5 pb-3">{children}</div>}
    </div>
  )
}
