import type { SettingsSection } from "@/lib/settings-dialog"
import {
  MicIcon,
  TvIcon,
  KeyIcon,
  BookOpenIcon,
  MusicIcon,
  RadioIcon,
  HelpCircleIcon,
  BrainCircuitIcon,
  HardDriveIcon,
  MonitorIcon,
  PaletteIcon,
  DownloadIcon,
} from "lucide-react"
import { StoragePanel } from "@/components/panels/settings/storage"
import { ProjectorCalibrationSection } from "@/components/settings/projector-calibration"
import { BrandingSection } from "@/components/settings/branding"
import { HighlightSettingsSection } from "@/components/settings/highlight-settings"
import { AudioSection } from "../(tabs)/audio-tab"
import { SpeechSection } from "../(tabs)/speech-tab"
import { DisplayModeSection } from "../(tabs)/display-mode-tab"
import { BibleSection } from "../(tabs)/bible-tab"
import { RemoteControlSection } from "../(tabs)/remote-control-tab"
import { HelpSection } from "../(tabs)/help-tab"
import { HymnalsSection } from "../(tabs)/hymnals-tab"
import { ImportSection } from "../(tabs)/import-tab"
import { ApiKeysSection } from "../(tabs)/api-keys-tab"
export type NavSection = SettingsSection

export type NavGroup =
  | "Setup"
  | "Output"
  | "Integrations"
  | "Maintenance"
  | "Help"

export const navItems: {
  name: string
  id: NavSection
  group: NavGroup
  icon: React.ReactNode
}[] = [
  {
    name: "Audio",
    id: "audio",
    group: "Setup",
    icon: <MicIcon strokeWidth={2} />,
  },
  {
    name: "Speech Recognition",
    id: "speech",
    group: "Setup",
    icon: <BrainCircuitIcon strokeWidth={2} />,
  },
  {
    name: "Bible",
    id: "bible",
    group: "Setup",
    icon: <BookOpenIcon strokeWidth={2} />,
  },
  {
    name: "Hymnals",
    id: "hymnals",
    group: "Setup",
    icon: <MusicIcon strokeWidth={2} />,
  },
  {
    name: "Import",
    id: "import",
    group: "Setup",
    icon: <DownloadIcon strokeWidth={2} />,
  },
  {
    name: "API Keys",
    id: "api-keys",
    group: "Setup",
    icon: <KeyIcon strokeWidth={2} />,
  },
  {
    name: "Display Mode",
    id: "display",
    group: "Output",
    icon: <TvIcon strokeWidth={2} />,
  },
  {
    name: "Church Profile",
    id: "branding",
    group: "Output",
    icon: <PaletteIcon strokeWidth={2} />,
  },
  {
    name: "Presentation",
    id: "presentation",
    group: "Output",
    icon: <PaletteIcon strokeWidth={2} />,
  },
  {
    name: "Projector",
    id: "projector",
    group: "Output",
    icon: <MonitorIcon strokeWidth={2} />,
  },
  {
    name: "Remote Control",
    id: "remote",
    group: "Integrations",
    icon: <RadioIcon strokeWidth={2} />,
  },
  {
    name: "Storage",
    id: "storage",
    group: "Maintenance",
    icon: <HardDriveIcon strokeWidth={2} />,
  },
  {
    name: "Help",
    id: "help",
    group: "Help",
    icon: <HelpCircleIcon strokeWidth={2} />,
  },
]

export const navGroups: NavGroup[] = [
  "Setup",
  "Output",
  "Integrations",
  "Maintenance",
  "Help",
]

export const sectionTitles: Record<NavSection, string> = {
  audio: "Audio",
  speech: "Speech Recognition",
  bible: "Bible Translation",
  display: "Display Mode",
  branding: "Church Profile",
  presentation: "Presentation",
  hymnals: "Hymnals",
  import: "Import from Other Software",
  remote: "Remote Control",
  "api-keys": "API Keys",
  storage: "Storage",
  projector: "Projector",
  help: "Help",
}

export const sectionComponents: Record<NavSection, React.FC> = {
  audio: AudioSection,
  speech: SpeechSection,
  bible: BibleSection,
  display: DisplayModeSection,
  branding: BrandingSection,
  presentation: HighlightSettingsSection,
  hymnals: HymnalsSection,
  import: ImportSection,
  remote: RemoteControlSection,
  "api-keys": ApiKeysSection,
  storage: StoragePanel,
  projector: ProjectorCalibrationSection,
  help: HelpSection,
}
