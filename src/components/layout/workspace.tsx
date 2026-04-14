import { useState, useMemo, useEffect } from "react"
import { Panel, Group, Separator, useGroupRef } from "react-resizable-panels"
import { Toolbar } from "./toolbar"
import { CommandPalette } from "@/components/command-palette"
import { createCommands } from "@/lib/command-registry"
import { useMenuEvents } from "@/hooks/use-menu-events"
import { useTheme } from "@/components/theme-provider"
import { useSettingsDialogStore } from "@/lib/settings-dialog"
import { useBroadcastStore, useTutorialStore, useTranscriptStore } from "@/stores"
import { invoke } from "@tauri-apps/api/core"
import { openUrl } from "@tauri-apps/plugin-opener"
import { PanelTabs } from "./panel-tabs"
import { TranscriptPanel } from "@/components/panels/transcript-panel"
import { SearchPanel } from "@/components/panels/search-panel"
import { DetectionsPanel } from "@/components/panels/detections-panel"
import { QueuePanel } from "@/components/panels/queue-panel"
import { CrossRefPanel } from "@/components/panels/crossref-panel"
import { BroadcastMonitor } from "@/components/broadcast/broadcast-monitor"
import { HistoryPanel } from "@/components/panels/history-panel"
import { AboutDialog } from "@/components/about-dialog"
import { EndSessionDialog } from "@/components/session/end-session-dialog"
import { ExportNotesDrawer } from "@/components/session/export-notes-drawer"
import { DistributeSummaryDrawer } from "@/components/session/distribute-summary-drawer"
import { AnnouncementDialog } from "@/components/broadcast/announcement-dialog"
import { ThemeDesigner } from "@/components/broadcast/theme-designer"
import { SessionsPanel } from "@/components/panels/sessions-panel"
import { AnalyticsPanel } from "@/components/panels/analytics-panel"
import { useAboutDialogStore } from "@/lib/about-dialog"
import { useEndSessionDialogStore } from "@/lib/end-session-dialog"
import { useExportNotesDrawerStore } from "@/lib/export-notes-drawer"
import { useDistributeSummaryDrawerStore } from "@/lib/distribute-summary-drawer"
import { useAnnouncementDialogStore } from "@/lib/announcement-dialog"
import { usePanelTabsStore } from "@/stores/panel-tabs-store"
import type { PanelId } from "@/stores/panel-tabs-store"
import { useSessionStore } from "@/stores"

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
/*  Constants                                                                 */
/* -------------------------------------------------------------------------- */

const TAB_PANEL_MAP: Record<string, PanelId> = {
  search: "left",
  notes: "left",
  songs: "left",
  sessions: "left",
  detections: "center",
  analytics: "center",
  queue: "right",
  "cross-refs": "right",
  planner: "right",
}

const DEFAULT_LAYOUT = { left: 25, center: 25, right: 25, broadcast: 25 }

/* -------------------------------------------------------------------------- */
/*  Workspace                                                                 */
/* -------------------------------------------------------------------------- */

export function Workspace() {
  const [transcriptCollapsed, setTranscriptCollapsed] = useState(true)
  const { theme, setTheme } = useTheme()
  const mainGroupRef = useGroupRef()
  const panelTabs = usePanelTabsStore()
  const isTranscribing = useTranscriptStore((s) => s.isTranscribing)

  // Auto-open transcript when service starts
  useEffect(() => {
    if (isTranscribing) {
      setTranscriptCollapsed(false)
    }
  }, [isTranscribing])

  const commands = useMemo(
    () =>
      createCommands({
        newSession: () => {
          usePanelTabsStore.getState().setTab("left", "sessions")
          const layout = mainGroupRef.current?.getLayout()
          if (layout && (layout.left ?? 0) < 15) {
            mainGroupRef.current?.setLayout(DEFAULT_LAYOUT)
          }
        },
        endSession: () => {
          const session = useSessionStore.getState().activeSession
          if (session) {
            useEndSessionDialogStore.getState().openEndSession(session.id)
          }
        },
        importPlan: () => {
          // Deferred until Planner feature is built
        },
        exportNotes: () => {
          const session = useSessionStore.getState().activeSession
          if (session) {
            useExportNotesDrawerStore.getState().openExportNotes(session.id)
          }
        },
        distributeSummary: () => {
          const session = useSessionStore.getState().activeSession
          if (session) {
            useDistributeSummaryDrawerStore.getState().openDistributeSummary(session.id)
          }
        },
        goLive: () => {
          useBroadcastStore.getState().goLive()
        },
        goOffAir: () => {
          useBroadcastStore.getState().clearScreen()
        },
        newAnnouncement: () => {
          useAnnouncementDialogStore.getState().openAnnouncement()
        },
        openThemeDesigner: () => {
          useBroadcastStore.getState().setDesignerOpen(true)
        },
        toggleTranscript: () => {
          setTranscriptCollapsed((prev) => !prev)
        },
        resetLayout: () => {
          mainGroupRef.current?.setLayout(DEFAULT_LAYOUT)
        },
        toggleTheme: () => {
          setTheme(theme === "dark" ? "light" : "dark")
        },
        openAbout: () => {
          useAboutDialogStore.getState().openAbout()
        },
        openPreferences: () => {
          useSettingsDialogStore.getState().openSettings()
        },
        quitApp: () => {
          invoke("quit_app")
        },
        openTutorial: () => {
          useTutorialStore.getState().startTutorial()
        },
        showKeyboardShortcuts: () => {
          useSettingsDialogStore.getState().openSettings("help")
        },
        openDocumentation: () => {
          openUrl("https://github.com/openbezal/rhema#readme")
        },
        reportIssue: () => {
          openUrl("https://github.com/openbezal/rhema/issues/new")
        },
        navigateTo: (tab: string) => {
          const panel = TAB_PANEL_MAP[tab]
          if (panel) {
            usePanelTabsStore.getState().setTab(panel, tab)
            const layout = mainGroupRef.current?.getLayout()
            if (layout && (layout[panel] ?? 0) < 15) {
              mainGroupRef.current?.setLayout(DEFAULT_LAYOUT)
            }
          }
        },
      }),
    [theme, setTheme, mainGroupRef]
  )

  // Bridge native menu events to command registry
  useMenuEvents(commands)

  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      {/* Command palette (Cmd+K) */}
      <CommandPalette commands={commands} />

      {/* Dialogs and drawers */}
      <AboutDialog />
      <EndSessionDialog />
      <ExportNotesDrawer />
      <DistributeSummaryDrawer />
      <AnnouncementDialog />
      <ThemeDesigner />

      {/* Toolbar */}
      <Toolbar />

      {/* Main workspace — horizontal panel group */}
      <Group
        orientation="horizontal"
        className="min-h-0 flex-1"
        groupRef={mainGroupRef}
      >
        {/* Left panel */}
        <Panel id="left" defaultSize="25%" minSize="15%" maxSize="40%">
          <PanelTabs
            className="h-full"
            activeTab={panelTabs.tabs.left}
            onTabChange={(id) => panelTabs.setTab("left", id)}
            tabs={[
              { id: "search", label: "Search", content: <SearchPanel /> },
              { id: "sessions", label: "Sessions", content: <SessionsPanel /> },
              { id: "notes", label: "Notes", content: <Placeholder label="Notes" /> },
              { id: "songs", label: "Songs", content: <Placeholder label="Songs" /> },
            ]}
          />
        </Panel>

        <VerticalHandle />

        {/* Center area — detections + transcript accordion */}
        <Panel id="center" defaultSize="25%" minSize="15%">
          <div className="flex h-full flex-col overflow-hidden">
            {/* Detections / analytics — takes remaining space */}
            <div className="min-h-0 flex-1 overflow-hidden">
              <PanelTabs
                className="h-full"
                activeTab={panelTabs.tabs.center}
                onTabChange={(id) => panelTabs.setTab("center", id)}
                tabs={[
                  { id: "detections", label: "Detections", content: <DetectionsPanel /> },
                  { id: "analytics", label: "Analytics", content: <AnalyticsPanel /> },
                ]}
              />
            </div>

            {/* Transcript accordion */}
            <div className={`flex shrink-0 flex-col border-t border-border ${transcriptCollapsed ? "" : "h-[40%] min-h-[120px]"}`}>
              {/* Header — always visible */}
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
                {isTranscribing && (
                  <span className="ml-auto flex items-center gap-1.5 text-[10px] font-medium text-red-500">
                    <span className="relative flex size-2">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-400 opacity-75" />
                      <span className="relative inline-flex size-2 rounded-full bg-red-500" />
                    </span>
                    Listening
                  </span>
                )}
              </button>

              {/* Content — hidden when collapsed */}
              {!transcriptCollapsed && (
                <div className="min-h-0 flex-1 overflow-auto">
                  <TranscriptPanel />
                </div>
              )}
            </div>
          </div>
        </Panel>

        <VerticalHandle />

        {/* Right panel — queue / staging */}
        <Panel id="right" defaultSize="25%" minSize="15%" maxSize="40%">
          <PanelTabs
            className="h-full"
            activeTab={panelTabs.tabs.right}
            onTabChange={(id) => panelTabs.setTab("right", id)}
            tabs={[
              { id: "queue", label: "Queue", content: <QueuePanel /> },
              { id: "history", label: "History", content: <HistoryPanel /> },
              { id: "cross-refs", label: "Cross-refs", content: <CrossRefPanel /> },
              { id: "planner", label: "Planner", content: <Placeholder label="Planner" /> },
            ]}
          />
        </Panel>

        <VerticalHandle />

        {/* Broadcast panel — Preview + On Screen (output) */}
        <Panel id="broadcast" defaultSize="25%" minSize="15%" maxSize="40%">
          <div className="flex h-full flex-col overflow-hidden">
            <BroadcastMonitor />
          </div>
        </Panel>
      </Group>
    </div>
  )
}
