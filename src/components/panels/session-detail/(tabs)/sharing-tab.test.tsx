import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { useSharingDrafts } from "../(hooks)/use-sharing-drafts"
import { SharingTab } from "./sharing-tab"
import { SessionHeader } from "../(components)/session-header"

vi.mock("../(components)/sermon-audio-panel", () => ({
  SermonAudioPanel: () => null,
  AudioUploadProgress: () => null,
}))

vi.mock("../(components)/sms-send-action", () => ({
  SmsSendAction: () => <button>Send SMS</button>,
}))

const local = vi.hoisted(() => ({
  connections: { publishing: false, sms: false },
}))
vi.mock("@/components/settings/(hooks)/use-church-connections", () => ({
  useChurchConnections: () => local.connections,
}))
beforeEach(() => {
  local.connections = { publishing: false, sms: false }
})

const sharing = {
  sessionId: 1,
  smsAlternatives: [],
  generateSmsAlternatives: vi.fn(),
  draft: {
    title: "A faithful life",
    recap: "Keep trusting God.",
    sms: "Keep trusting God this week.",
  },
  operation: "idle",
  error: null,
  dirty: false,
  publication: null,
  generate: vi.fn(),
  save: vi.fn(),
  update: vi.fn(),
  publish: vi.fn(),
  retry: vi.fn(),
} satisfies ReturnType<typeof useSharingDrafts>

function render(kind: "sms" | "public-recap") {
  return renderToStaticMarkup(
    <SharingTab
      kind={kind}
      sharing={sharing}
      summary={null}
      title="A faithful life"
      summarizing={false}
    />
  )
}

describe("separate sharing tabs", () => {
  it("keeps SMS controls out of Public Recap", () => {
    const html = render("public-recap")
    expect(html).toContain('aria-label="Public Recap"')
    expect(html).toContain('aria-label="Sermon recap draft"')
    expect(html).not.toContain('aria-label="Sermon audio"')
    expect(html).not.toContain('aria-label="SMS draft"')
    expect(html).not.toContain("Send SMS</button>")
  })

  it("keeps recap editing out of SMS", () => {
    const html = render("sms")
    expect(html).toContain('aria-label="SMS draft"')
    expect(html).not.toContain("Send SMS</button>")
    expect(html).toContain("Copy this message")
    expect(html).not.toContain('aria-label="Sermon recap draft"')
  })

  it("retains direct actions for a configured church", () => {
    local.connections = { publishing: true, sms: true }
    expect(render("sms")).toContain("Send SMS</button>")
    expect(render("public-recap")).toContain("Publish recap")
  })

  it("shows Summary, Public Recap, SMS in the requested order", () => {
    const html = renderToStaticMarkup(
      <SessionHeader
        sessionTitle="Session"
        tab="sms"
        onBack={() => {}}
        onEndSession={() => {}}
        onTabChange={() => {}}
        metadata={null}
        exportMenu={null}
      />
    )
    expect(html.indexOf("Summary</button>")).toBeLessThan(
      html.indexOf("Public Recap</button>")
    )
    expect(html.indexOf("Public Recap</button>")).toBeLessThan(
      html.indexOf("SMS</button>")
    )
    expect(html).toContain('aria-current="page"')
  })
})

it("allows transcript recap generation before a summary exists", () => {
  const html = render("public-recap")
  const button = html.match(/<button[^>]*>[^]*?Regenerate recap<\/button>/)?.[0]
  expect(button).toBeDefined()
  expect(button).not.toContain('disabled=""')
  expect(html).not.toContain("Generate a summary with sermon teaching")
})
