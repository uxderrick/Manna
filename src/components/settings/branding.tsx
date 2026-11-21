import { PrivateChurchArtwork } from "./(components)/private-church-artwork"
import { useChurchConnections } from "./(hooks)/use-church-connections"
import { useState } from "react"
import {
  ChurchIcon,
  UsersIcon,
  PanelsTopLeftIcon,
  MonitorIcon,
  HeartHandshakeIcon,
  SendIcon,
  MusicIcon,
  ArrowUpRightIcon,
} from "lucide-react"
import { ChurchProfileFields } from "./(components)/church-profile-fields"
import { ChurchProfileAssets } from "./(components)/church-profile-assets"
import { GivingDetails } from "./(components)/giving-details"
import { BlankBackgroundSettings } from "./blank-background"
import { HighlightSettingsSection } from "./highlight-settings"
import { DisplayModeSection } from "./(tabs)/display-mode-tab"
import { HymnalsSection } from "./(tabs)/hymnals-tab"
import { SlidePresets } from "./(components)/slide-presets"
import { ChurchMessaging } from "./(components)/church-messaging"
import { Button } from "@/components/ui/button"
import { openSettings } from "@/lib/settings-dialog"

const sections = [
  { id: "identity", label: "Identity & branding", icon: ChurchIcon },
  { id: "speakers", label: "Speakers", icon: UsersIcon },
  { id: "slides", label: "Slide presets", icon: PanelsTopLeftIcon },
  { id: "presentation", label: "Presentation defaults", icon: MonitorIcon },
  { id: "giving", label: "Giving", icon: HeartHandshakeIcon },
  { id: "publishing", label: "Publishing & messaging", icon: SendIcon },
  { id: "worship", label: "Worship collections", icon: MusicIcon },
] as const
export function BrandingSection() {
  const connections = useChurchConnections()
  const [active, setActive] =
    useState<(typeof sections)[number]["id"]>("identity")
  return (
    <div className="grid min-h-full grid-cols-[160px_minmax(0,1fr)] lg:grid-cols-[200px_minmax(0,1fr)]">
      <nav
        aria-label="Church profile sections"
        className="sticky top-0 flex h-fit flex-col gap-1 self-start px-3 py-6"
      >
        {sections
          .filter(
            ({ id }) =>
              id !== "publishing" || connections.publishing || connections.sms
          )
          .map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              size="sm"
              variant={active === id ? "secondary" : "ghost"}
              aria-current={active === id ? "page" : undefined}
              onClick={() => setActive(id)}
              className="h-auto min-h-9 w-full justify-start gap-2 px-2.5 py-2 text-left text-xs whitespace-normal"
            >
              <Icon className="size-3.5 shrink-0" />
              {label}
            </Button>
          ))}
      </nav>
      <section
        key={active}
        aria-label={sections.find((s) => s.id === active)!.label}
        className="min-w-0 space-y-6 border-l p-6 lg:p-8"
      >
        <h3 className="text-sm font-semibold">
          {sections.find((s) => s.id === active)!.label}
        </h3>
        {active === "identity" && (
          <>
            <ChurchProfileFields
              fields={[
                {
                  key: "churchName",
                  label: "Church name",
                  placeholder: "Your church",
                },
                { key: "campusName", label: "Campus", placeholder: "Optional" },
              ]}
            />
            <ChurchProfileAssets kinds={["logo"]} />
            <PrivateChurchArtwork />
          </>
        )}
        {active === "speakers" && (
          <>
            <ChurchProfileFields
              fields={[
                {
                  key: "defaultSpeakerName",
                  label: "Default speaker",
                  placeholder: "Speaker name",
                },
              ]}
            />
            <p className="text-xs text-muted-foreground">
              Used on new title slides. You can change the speaker on each
              slide.
            </p>
          </>
        )}
        {active === "slides" && <SlidePresets />}
        {active === "presentation" && (
          <>
            <BlankBackgroundSettings />
            <ChurchProfileAssets kinds={["blank"]} />
            <div className="border-t pt-5">
              <HighlightSettingsSection />
            </div>
            <div className="border-t pt-5">
              <DisplayModeSection />
            </div>
          </>
        )}
        {active === "giving" && (
          <>
            <GivingDetails />
            <ChurchProfileAssets kinds={["momo"]} />
          </>
        )}
        {active === "publishing" && (
          <>
            <ChurchMessaging />
            <Button
              size="sm"
              variant="outline"
              onClick={() => openSettings("api-keys")}
            >
              Manage API keys
              <ArrowUpRightIcon className="size-3.5" />
            </Button>
          </>
        )}
        {active === "worship" && <HymnalsSection />}
      </section>
    </div>
  )
}
