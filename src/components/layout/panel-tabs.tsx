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
  activeTab?: string
  onTabChange?: (tabId: string) => void
  className?: string
}

export function PanelTabs({ tabs, defaultTab, activeTab: controlledTab, onTabChange, className }: PanelTabsProps) {
  const [internalTab, setInternalTab] = useState(defaultTab ?? tabs[0]?.id ?? "")

  const isControlled = controlledTab !== undefined
  const activeTab = isControlled ? controlledTab : internalTab

  function handleTabChange(tabId: string) {
    if (isControlled) {
      onTabChange?.(tabId)
    } else {
      setInternalTab(tabId)
    }
  }

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
            onClick={() => handleTabChange(tab.id)}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {active?.content}
      </div>
    </div>
  )
}
