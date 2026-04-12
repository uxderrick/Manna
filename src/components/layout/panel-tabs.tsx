import { useState } from "react"

export interface PanelTab {
  id: string
  label: string
  icon?: React.ReactNode
  content: React.ReactNode
}

interface PanelTabsProps {
  tabs: PanelTab[]
  defaultTab?: string
  className?: string
}

export function PanelTabs({ tabs, defaultTab, className }: PanelTabsProps) {
  const [activeTab, setActiveTab] = useState(defaultTab ?? tabs[0]?.id ?? "")
  const active = tabs.find((t) => t.id === activeTab) ?? tabs[0]

  return (
    <div className={`flex min-h-0 flex-col ${className ?? ""}`}>
      {/* Tab bar */}
      <div className="flex shrink-0 items-center gap-0.5 border-b border-border bg-muted/30 px-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            data-active={tab.id === activeTab || undefined}
            className="flex items-center gap-1.5 border-b-2 border-transparent px-2.5 py-1.5 text-xs text-muted-foreground transition-colors duration-[var(--duration-fast)] hover:text-foreground data-[active]:border-primary data-[active]:text-foreground"
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-auto">
        {active?.content}
      </div>
    </div>
  )
}
