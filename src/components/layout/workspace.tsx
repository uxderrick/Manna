import { useState, useMemo } from "react"
import { Panel, Group, Separator } from "react-resizable-panels"
import { Toolbar } from "./toolbar"
import { CommandPalette } from "@/components/command-palette"
import { createCommands } from "@/lib/command-registry"
import { useMenuEvents } from "@/hooks/use-menu-events"
import { useTheme } from "@/components/theme-provider"
import { PanelTabs } from "./panel-tabs"
import { TranscriptPanel } from "@/components/panels/transcript-panel"
import { SearchPanel } from "@/components/panels/search-panel"
import { DetectionsPanel } from "@/components/panels/detections-panel"
import { QueuePanel } from "@/components/panels/queue-panel"
import { BroadcastMonitor } from "@/components/broadcast/broadcast-monitor"

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
  const { theme, setTheme } = useTheme()

  const commands = useMemo(
    () =>
      createCommands({
        newSession: () => {
          /* TODO: wire to session creation flow */
        },
        endSession: () => {
          /* TODO: wire to session end flow */
        },
        importPlan: () => {
          /* TODO: wire to import flow */
        },
        exportNotes: () => {
          /* TODO: wire to export flow */
        },
        distributeSummary: () => {
          /* TODO: wire to distribution flow */
        },
        goLive: () => {
          /* TODO: wire to broadcast start */
        },
        goOffAir: () => {
          /* TODO: wire to broadcast stop */
        },
        newAnnouncement: () => {
          /* TODO: wire to announcement flow */
        },
        openThemeDesigner: () => {
          /* TODO: wire to theme designer */
        },
        toggleTranscript: () => {
          setTranscriptCollapsed((prev) => !prev)
        },
        resetLayout: () => {
          /* TODO: wire to panel reset */
        },
        toggleTheme: () => {
          setTheme(theme === "dark" ? "light" : "dark")
        },
        openAbout: () => {
          /* TODO: wire to about dialog */
        },
        openPreferences: () => {
          /* TODO: wire to preferences */
        },
        quitApp: () => {
          /* TODO: wire to app quit via Tauri */
        },
        openTutorial: () => {
          /* TODO: wire to tutorial */
        },
        showKeyboardShortcuts: () => {
          /* TODO: wire to shortcuts dialog */
        },
        openDocumentation: () => {
          /* TODO: wire to docs URL */
        },
        reportIssue: () => {
          /* TODO: wire to issue URL */
        },
        navigateTo: (_tab: string) => {
          /* TODO: wire to panel tab navigation */
        },
      }),
    [theme, setTheme]
  )

  // Bridge native menu events to command registry
  useMenuEvents(commands)

  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      {/* Command palette (Cmd+K) */}
      <CommandPalette commands={commands} />

      {/* Toolbar */}
      <Toolbar />

      {/* Main workspace — horizontal panel group */}
      <Group
        orientation="horizontal"
        className="min-h-0 flex-1"
      >
        {/* Left panel */}
        <Panel id="left" defaultSize="22%" minSize="15%" maxSize="35%">
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
        <Panel id="center" defaultSize="50%" minSize="30%">
          <Group
            orientation="vertical"
            className="h-full"
          >
            {/* Center top: detections / preview / analytics */}
            <Panel id="content" defaultSize="80%" minSize="30%">
              <PanelTabs
                className="h-full"
                defaultTab="detections"
                tabs={[
                  { id: "detections", label: "Detections", content: <DetectionsPanel /> },
                  { id: "analytics", label: "Analytics", content: <Placeholder label="Analytics" /> },
                ]}
              />
            </Panel>

            <HorizontalHandle />

            {/* Center bottom: transcript */}
            <Panel
              id="transcript"
              defaultSize="20%"
              minSize="5%"
              maxSize="50%"
              collapsible
              collapsedSize="0%"
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

        {/* Right panel — queue + broadcast monitor */}
        <Panel id="right" defaultSize="28%" minSize="15%" maxSize="40%">
          <div className="flex h-full flex-col overflow-hidden">
            {/* Queue tabs — top section */}
            <div className="min-h-0 flex-1 overflow-hidden">
              <PanelTabs
                className="h-full"
                defaultTab="queue"
                tabs={[
                  { id: "queue", label: "Queue", content: <QueuePanel /> },
                  { id: "cross-refs", label: "Cross-refs", content: <Placeholder label="Cross-refs" /> },
                  { id: "planner", label: "Planner", content: <Placeholder label="Planner" /> },
                ]}
              />
            </div>
            {/* Broadcast monitor — always visible */}
            <BroadcastMonitor />
          </div>
        </Panel>
      </Group>
    </div>
  )
}
