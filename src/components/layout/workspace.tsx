import { useState } from "react"
import { Panel, Group, Separator } from "react-resizable-panels"
import { MenuBar } from "./menu-bar"
import { Toolbar } from "./toolbar"
import { PanelTabs } from "./panel-tabs"
import { TranscriptPanel } from "@/components/panels/transcript-panel"
import { SearchPanel } from "@/components/panels/search-panel"
import { DetectionsPanel } from "@/components/panels/detections-panel"
import { PreviewPanel } from "@/components/panels/preview-panel"
import { QueuePanel } from "@/components/panels/queue-panel"

/* -------------------------------------------------------------------------- */
/*  Resize handles                                                            */
/* -------------------------------------------------------------------------- */

function VerticalHandle() {
  return (
    <Separator className="group relative w-1 shrink-0 bg-transparent transition-colors hover:bg-primary/10">
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-primary/50" />
    </Separator>
  )
}

function HorizontalHandle() {
  return (
    <Separator className="group relative h-1 shrink-0 bg-transparent transition-colors hover:bg-primary/10">
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border transition-colors group-hover:bg-primary/50" />
    </Separator>
  )
}

/* -------------------------------------------------------------------------- */
/*  Placeholder tab content                                                   */
/* -------------------------------------------------------------------------- */

function Placeholder({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {label} — coming in Wave 2
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Workspace                                                                 */
/* -------------------------------------------------------------------------- */

export function Workspace() {
  const [transcriptCollapsed, setTranscriptCollapsed] = useState(false)

  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      {/* Menu bar */}
      <MenuBar />

      {/* Toolbar */}
      <Toolbar />

      {/* Main workspace — horizontal panel group */}
      <Group
        orientation="horizontal"
        className="min-h-0 flex-1"
      >
        {/* Left panel */}
        <Panel defaultSize={22} minSize={15} maxSize={35}>
          <PanelTabs
            className="h-full"
            defaultTab="search"
            tabs={[
              { id: "search", label: "Search", content: <SearchPanel /> },
              { id: "notes", label: "Notes", content: <Placeholder label="Notes" /> },
              { id: "songs", label: "Songs", content: <Placeholder label="Songs" /> },
            ]}
          />
        </Panel>

        <VerticalHandle />

        {/* Center area — vertical split */}
        <Panel defaultSize={50} minSize={30}>
          <Group
            orientation="vertical"
            className="h-full"
          >
            {/* Center top: detections / preview / analytics */}
            <Panel defaultSize={80} minSize={30}>
              <PanelTabs
                className="h-full"
                defaultTab="detections"
                tabs={[
                  { id: "detections", label: "Detections", content: <DetectionsPanel /> },
                  { id: "broadcast", label: "Broadcast Preview", content: <PreviewPanel /> },
                  { id: "analytics", label: "Analytics", content: <Placeholder label="Analytics" /> },
                ]}
              />
            </Panel>

            <HorizontalHandle />

            {/* Center bottom: transcript */}
            <Panel
              defaultSize={20}
              minSize={8}
              maxSize={50}
              collapsible
              collapsedSize={0}
            >
              <div className="flex h-full flex-col overflow-hidden border-t border-border">
                {/* Transcript header */}
                <button
                  className="flex h-7 shrink-0 items-center gap-1.5 bg-muted/30 px-3 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                  onClick={() => setTranscriptCollapsed((prev) => !prev)}
                >
                  <span
                    className="text-[10px] transition-transform"
                    style={{
                      transform: transcriptCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                    }}
                  >
                    ▼
                  </span>
                  <span className="font-medium">Transcript</span>
                </button>

                {/* Transcript content */}
                <div className="min-h-0 flex-1 overflow-auto">
                  <TranscriptPanel />
                </div>
              </div>
            </Panel>
          </Group>
        </Panel>

        <VerticalHandle />

        {/* Right panel */}
        <Panel defaultSize={28} minSize={15} maxSize={40}>
          <PanelTabs
            className="h-full"
            defaultTab="queue"
            tabs={[
              { id: "queue", label: "Queue", content: <QueuePanel /> },
              { id: "cross-refs", label: "Cross-refs", content: <Placeholder label="Cross-refs" /> },
              { id: "planner", label: "Planner", content: <Placeholder label="Planner" /> },
            ]}
          />
        </Panel>
      </Group>
    </div>
  )
}
