import { useState, useEffect, useMemo } from "react"
import { Panel, Group, Separator, useGroupCallbackRef } from "react-resizable-panels"
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
import { ServicePlanPanel } from "@/components/panels/service-plan-panel"
// PlannerPanel merged into QueuePanel — search + queue in one place
import { BroadcastMonitor } from "@/components/broadcast/broadcast-monitor"
import { HistoryPanel } from "@/components/panels/history-panel"
import { SessionsLanding } from "./sessions-landing"
import { ProjectorPickerDialog } from "@/components/broadcast/projector-picker-dialog"
import { AboutDialog } from "@/components/about-dialog"
import { EndSessionDialog } from "@/components/session/end-session-dialog"
import { ExportNotesDrawer } from "@/components/session/export-notes-drawer"
import { DistributeSummaryDrawer } from "@/components/session/distribute-summary-drawer"
import { AnnouncementDialog } from "@/components/broadcast/announcement-dialog"
import { NotesSelectionDrawer } from "@/components/notes/notes-selection-drawer"
import { ThemeDesigner } from "@/components/broadcast/theme-designer"
import { NotesPanel } from "@/components/panels/notes-panel"
import { SongsPanel } from "@/components/panels/songs-panel"
import { MediaPanel } from "@/components/panels/media-panel"
import { SongJumpDialog } from "@/components/songs/song-jump-dialog"
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
/*  Constants                                                                 */
/* -------------------------------------------------------------------------- */

const TAB_PANEL_MAP: Record<string, PanelId> = {
  search: "left",
  notes: "left",
  songs: "left",
  images: "left",
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
  const [transcriptCollapsed, setTranscriptCollapsed] = useState(() => !useTranscriptStore.getState().isTranscribing)
  const [songJumpOpen, setSongJumpOpen] = useState(false)
  const { theme, setTheme } = useTheme()
  const [mainGroup, setMainGroup] = useGroupCallbackRef()
  const [rightGroup, setRightGroup] = useGroupCallbackRef()
  const panelTabs = usePanelTabsStore()
  const isTranscribing = useTranscriptStore((s) => s.isTranscribing)
  const activeSession = useSessionStore((s) => s.activeSession)
  const workspaceUnlocked = useSessionStore((s) => s.workspaceUnlocked)
  const sessionsMode = useSessionStore((s) => s.sessionsMode)
  const showLanding = !activeSession && !workspaceUnlocked

  // Cmd/Ctrl+G — open song jump dialog.
  // Skip when user is typing in an input/textarea/contentEditable so we
  // don't hijack native Find-Next or break text composition.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod || e.key.toLowerCase() !== "g") return
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return
      }
      e.preventDefault()
      setSongJumpOpen(true)
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  // The external transcription store signals when a service starts.
  useEffect(() => useTranscriptStore.subscribe((state, previous) => {
    if (state.isTranscribing && !previous.isTranscribing) setTranscriptCollapsed(false)
  }), [])

  const commands = useMemo(() => createCommands({
        newSession: () => {
          usePanelTabsStore.getState().setTab("left", "sessions")
          const layout = mainGroup?.getLayout()
          if (layout && (layout.left ?? 0) < 15) {
            mainGroup?.setLayout(DEFAULT_LAYOUT)
          }
        },
        endSession: () => {
          const session = useSessionStore.getState().activeSession
          if (session) {
            useEndSessionDialogStore.getState().openEndSession(session.id)
          }
        },
        viewAllSessions: () => {
          useSessionStore.getState().openSessions()
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
          mainGroup?.setLayout(DEFAULT_LAYOUT)
        },
        toggleTheme: () => {
          setTheme(theme === "dark" ? "light" : "dark")
        },
        reloadWindow: () => {
          // Confirm before reloading mid-service so the user doesn't lose
          // queue state on an accidental Cmd+R press during a live broadcast.
          const isLive = useBroadcastStore.getState().isLive
          if (isLive && !window.confirm("Reload window? Live broadcast will pause and queue state may reset.")) {
            return
          }
          window.location.reload()
        },
        openDevtools: () => {
          void invoke("open_devtools")
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
          // Plan now lives in its own pinned bottom slot — expand it if collapsed.
          if (tab === "plan") {
            const mainLayout = mainGroup?.getLayout()
            if (mainLayout && (mainLayout.right ?? 0) < 15) {
              mainGroup?.setLayout(DEFAULT_LAYOUT)
            }
            const rightLayout = rightGroup?.getLayout()
            if (rightLayout && (rightLayout["right-bottom"] ?? 0) < 15) {
              rightGroup?.setLayout({ "right-top": 60, "right-bottom": 40 })
            }
            return
          }
          const panel = TAB_PANEL_MAP[tab]
          if (panel) {
            usePanelTabsStore.getState().setTab(panel, tab)
            const layout = mainGroup?.getLayout()
            if (layout && (layout[panel] ?? 0) < 15) {
              mainGroup?.setLayout(DEFAULT_LAYOUT)
            }
          }
        },
      }), [theme, setTheme, mainGroup, rightGroup])

  // Bridge native menu events to command registry
  useMenuEvents(commands)

  if (showLanding) {
    return <SessionsLanding />
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      {sessionsMode && <SessionsLanding />}
      {/* Command palette (Cmd+K) */}
      <CommandPalette commands={commands} />

      {/* Dialogs and drawers */}
      <AboutDialog />
      <EndSessionDialog />
      <ExportNotesDrawer />
      <DistributeSummaryDrawer />
      <AnnouncementDialog />
      <NotesSelectionDrawer />
      <ThemeDesigner />
      <ProjectorPickerDialog />
      <SongJumpDialog open={songJumpOpen} onOpenChange={setSongJumpOpen} />

      {/* Toolbar */}
      <Toolbar />

      {/* Main workspace — horizontal panel group */}
      <Group
        orientation="horizontal"
        className="min-h-0 flex-1"
        groupRef={setMainGroup}
      >
        {/* Left panel */}
        <Panel id="left" defaultSize="25%" minSize="15%" maxSize="40%">
          <PanelTabs
            className="h-full"
            activeTab={panelTabs.tabs.left}
            onTabChange={(id) => panelTabs.setTab("left", id)}
            tabs={[
              { id: "search", label: "Bible", content: <SearchPanel /> },
              { id: "notes", label: "Notes", content: <NotesPanel /> },
              { id: "songs", label: "Songs", content: <SongsPanel /> },
              { id: "images", label: "Media", content: <MediaPanel /> },
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

              {/* Content — visually hidden when collapsed, always mounted for event listeners */}
              <div className={`min-h-0 flex-1 overflow-auto ${transcriptCollapsed ? "hidden" : ""}`}>
                <TranscriptPanel />
              </div>
            </div>
          </div>
        </Panel>

        <VerticalHandle />

        {/* Right column — top: queue/history/cross-refs tabs, bottom: persistent service plan */}
        <Panel id="right" defaultSize="25%" minSize="15%" maxSize="40%">
          <Group orientation="vertical" className="h-full" groupRef={setRightGroup}>
            <Panel id="right-top" defaultSize="60%" minSize="20%">
              <PanelTabs
                className="h-full"
                activeTab={panelTabs.tabs.right}
                onTabChange={(id) => panelTabs.setTab("right", id)}
                tabs={[
                  { id: "queue", label: "Queue", content: <QueuePanel /> },
                  { id: "history", label: "History", content: <HistoryPanel /> },
                  { id: "cross-refs", label: "Cross-refs", content: <CrossRefPanel /> },
                ]}
              />
            </Panel>
            <HorizontalHandle />
            <Panel id="right-bottom" defaultSize="40%" minSize="15%">
              <div className="flex h-full flex-col overflow-hidden bg-card">
                <div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-border bg-muted/30 px-3 text-xs font-medium text-muted-foreground">
                  Service Plan
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  <ServicePlanPanel />
                </div>
              </div>
            </Panel>
          </Group>
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
