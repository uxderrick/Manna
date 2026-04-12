import { useState } from "react"
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels"
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

function VerticalResizeHandle() {
  return (
    <PanelResizeHandle className="group relative w-px bg-border transition-colors duration-[var(--duration-fast)] hover:bg-transparent">
      <div className="absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 rounded-full bg-transparent transition-colors duration-[var(--duration-fast)] group-hover:bg-primary/40 group-data-[resize-handle-active]:bg-primary/60" />
    </PanelResizeHandle>
  )
}

function HorizontalResizeHandle() {
  return (
    <PanelResizeHandle className="group relative h-px bg-border transition-colors duration-[var(--duration-fast)] hover:bg-transparent">
      <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-transparent transition-colors duration-[var(--duration-fast)] group-hover:bg-primary/40 group-data-[resize-handle-active]:bg-primary/60" />
    </PanelResizeHandle>
  )
}

/* -------------------------------------------------------------------------- */
/*  Placeholder tab content                                                   */
/* -------------------------------------------------------------------------- */

function NotesPlaceholder() {
  return (
    <div className="p-3 text-sm text-muted-foreground">
      Notes — coming in Wave 2
    </div>
  )
}

function SongsPlaceholder() {
  return (
    <div className="p-3 text-sm text-muted-foreground">
      Songs — coming in Wave 2
    </div>
  )
}

function AnalyticsPlaceholder() {
  return (
    <div className="p-3 text-sm text-muted-foreground">
      Analytics — coming in Wave 2
    </div>
  )
}

function CrossRefsPlaceholder() {
  return (
    <div className="p-3 text-sm text-muted-foreground">
      Cross-refs — coming in Wave 2
    </div>
  )
}

function PlannerPlaceholder() {
  return (
    <div className="p-3 text-sm text-muted-foreground">
      Planner — coming in Wave 2
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
      <PanelGroup
        autoSaveId="manna-workspace-h"
        direction="horizontal"
        className="min-h-0 flex-1"
      >
        {/* Left panel */}
        <Panel defaultSize={22} minSize={15} maxSize={35}>
          <PanelTabs
            className="h-full"
            defaultTab="search"
            tabs={[
              {
                id: "search",
                label: "Search",
                content: <SearchPanel />,
              },
              {
                id: "notes",
                label: "Notes",
                content: <NotesPlaceholder />,
              },
              {
                id: "songs",
                label: "Songs",
                content: <SongsPlaceholder />,
              },
            ]}
          />
        </Panel>

        <VerticalResizeHandle />

        {/* Center area — vertical split */}
        <Panel defaultSize={50} minSize={30}>
          <PanelGroup
            autoSaveId="manna-workspace-v"
            direction="vertical"
            className="h-full"
          >
            {/* Center top: detections / preview / analytics */}
            <Panel minSize={30}>
              <PanelTabs
                className="h-full"
                defaultTab="detections"
                tabs={[
                  {
                    id: "detections",
                    label: "Detections",
                    content: <DetectionsPanel />,
                  },
                  {
                    id: "broadcast",
                    label: "Broadcast Preview",
                    content: <PreviewPanel />,
                  },
                  {
                    id: "analytics",
                    label: "Analytics",
                    content: <AnalyticsPlaceholder />,
                  },
                ]}
              />
            </Panel>

            <HorizontalResizeHandle />

            {/* Center bottom: collapsible transcript bar */}
            <Panel
              defaultSize={15}
              minSize={transcriptCollapsed ? 8 : 8}
              maxSize={50}
              collapsible
              collapsedSize={8}
              onCollapse={() => setTranscriptCollapsed(true)}
              onExpand={() => setTranscriptCollapsed(false)}
            >
              <div className="flex h-full flex-col">
                {/* Transcript header / toggle */}
                <button
                  className="flex h-7 shrink-0 cursor-default items-center gap-1.5 border-b border-border bg-muted/30 px-3 text-xs text-muted-foreground transition-colors duration-[var(--duration-fast)] hover:bg-muted/60 hover:text-foreground"
                  onClick={() => setTranscriptCollapsed((prev) => !prev)}
                >
                  <span
                    className="transition-transform duration-[var(--duration-fast)]"
                    style={{
                      transform: transcriptCollapsed
                        ? "rotate(-90deg)"
                        : "rotate(0deg)",
                    }}
                  >
                    ▼
                  </span>
                  <span className="font-medium">Transcript</span>
                </button>

                {/* Transcript content */}
                {!transcriptCollapsed && (
                  <div className="min-h-0 flex-1 overflow-auto">
                    <TranscriptPanel />
                  </div>
                )}
              </div>
            </Panel>
          </PanelGroup>
        </Panel>

        <VerticalResizeHandle />

        {/* Right panel */}
        <Panel defaultSize={28} minSize={15} maxSize={40}>
          <PanelTabs
            className="h-full"
            defaultTab="queue"
            tabs={[
              {
                id: "queue",
                label: "Queue",
                content: <QueuePanel />,
              },
              {
                id: "cross-refs",
                label: "Cross-refs",
                content: <CrossRefsPlaceholder />,
              },
              {
                id: "planner",
                label: "Planner",
                content: <PlannerPlaceholder />,
              },
            ]}
          />
        </Panel>
      </PanelGroup>
    </div>
  )
}
