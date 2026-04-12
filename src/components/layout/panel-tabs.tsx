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
    <div className={`flex min-h-0 min-w-0 flex-col overflow-hidden ${className ?? ""}`}>
      {/* Tab bar */}
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-muted/30 px-2 py-1.5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            data-active={tab.id === activeTab || undefined}
            className="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-primary/8 hover:text-primary data-[active]:bg-primary data-[active]:text-primary-foreground"
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {active?.content}
      </div>
    </div>
  )
}
