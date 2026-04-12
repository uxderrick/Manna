import { useSessionStore } from "@/stores"

export type CommandGroup =
  | "Manna"
  | "Session"
  | "Broadcast"
  | "View"
  | "Navigate"
  | "Help"

export interface AppCommand {
  id: string
  label: string
  group: CommandGroup
  shortcut?: string
  enabled?: () => boolean
  execute: () => void
}

// Helpers to read session state outside of React
function hasActiveSession(): boolean {
  return useSessionStore.getState().activeSession !== null
}

function hasLiveSession(): boolean {
  return useSessionStore.getState().activeSession?.status === "live"
}

export function createCommands(actions: {
  newSession: () => void
  endSession: () => void
  importPlan: () => void
  exportNotes: () => void
  distributeSummary: () => void
  goLive: () => void
  goOffAir: () => void
  newAnnouncement: () => void
  openThemeDesigner: () => void
  toggleTranscript: () => void
  resetLayout: () => void
  toggleTheme: () => void
  openAbout: () => void
  openPreferences: () => void
  quitApp: () => void
  openTutorial: () => void
  showKeyboardShortcuts: () => void
  openDocumentation: () => void
  reportIssue: () => void
  navigateTo: (tab: string) => void
}): AppCommand[] {
  return [
    // Manna
    { id: "manna:about", label: "About Manna", group: "Manna", execute: actions.openAbout },
    { id: "manna:preferences", label: "Preferences…", group: "Manna", shortcut: "⌘,", execute: actions.openPreferences },
    { id: "manna:quit", label: "Quit Manna", group: "Manna", shortcut: "⌘Q", execute: actions.quitApp },

    // Session
    { id: "session:new", label: "New Session…", group: "Session", shortcut: "⌘N", execute: actions.newSession },
    { id: "session:end", label: "End Session", group: "Session", shortcut: "⌘⇧E", enabled: hasLiveSession, execute: actions.endSession },
    { id: "session:import-plan", label: "Import Plan…", group: "Session", execute: actions.importPlan },
    { id: "session:export-notes", label: "Export Notes…", group: "Session", shortcut: "⌘⇧X", enabled: hasActiveSession, execute: actions.exportNotes },
    { id: "session:distribute-summary", label: "Distribute Summary…", group: "Session", enabled: hasActiveSession, execute: actions.distributeSummary },

    // Broadcast
    { id: "broadcast:go-live", label: "Go Live", group: "Broadcast", shortcut: "⌘L", execute: actions.goLive },
    { id: "broadcast:go-off-air", label: "Go Off Air", group: "Broadcast", shortcut: "⌘⇧L", execute: actions.goOffAir },
    { id: "broadcast:new-announcement", label: "New Announcement…", group: "Broadcast", shortcut: "⌘⇧N", execute: actions.newAnnouncement },
    { id: "broadcast:theme-designer", label: "Theme Designer…", group: "Broadcast", shortcut: "⌘T", execute: actions.openThemeDesigner },

    // View
    { id: "view:toggle-transcript", label: "Toggle Transcript", group: "View", shortcut: "⌘J", execute: actions.toggleTranscript },
    { id: "view:reset-layout", label: "Reset Layout", group: "View", execute: actions.resetLayout },
    { id: "view:toggle-theme", label: "Toggle Theme", group: "View", execute: actions.toggleTheme },

    // Navigate
    { id: "navigate:search", label: "Search", group: "Navigate", execute: () => actions.navigateTo("search") },
    { id: "navigate:notes", label: "Notes", group: "Navigate", execute: () => actions.navigateTo("notes") },
    { id: "navigate:songs", label: "Songs", group: "Navigate", execute: () => actions.navigateTo("songs") },
    { id: "navigate:queue", label: "Queue", group: "Navigate", execute: () => actions.navigateTo("queue") },
    { id: "navigate:cross-refs", label: "Cross-refs", group: "Navigate", execute: () => actions.navigateTo("cross-refs") },
    { id: "navigate:planner", label: "Planner", group: "Navigate", execute: () => actions.navigateTo("planner") },
    { id: "navigate:detections", label: "Detections", group: "Navigate", execute: () => actions.navigateTo("detections") },
    { id: "navigate:broadcast-preview", label: "Broadcast Preview", group: "Navigate", execute: () => actions.navigateTo("broadcast") },
    { id: "navigate:analytics", label: "Analytics", group: "Navigate", execute: () => actions.navigateTo("analytics") },

    // Help
    { id: "help:tutorial", label: "Tutorial", group: "Help", execute: actions.openTutorial },
    { id: "help:keyboard-shortcuts", label: "Keyboard Shortcuts", group: "Help", shortcut: "⌘/", execute: actions.showKeyboardShortcuts },
    { id: "help:documentation", label: "Documentation", group: "Help", execute: actions.openDocumentation },
    { id: "help:report-issue", label: "Report Issue", group: "Help", execute: actions.reportIssue },
  ]
}
