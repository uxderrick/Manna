// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { ImportSection } from "./import-tab"

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  hydrateSongs: vi.fn(),
  setTranslations: vi.fn(),
}))
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }))
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: native.open }))
vi.mock("sonner", () => ({
  toast: { success: native.success, warning: native.warning, error: native.error },
}))
vi.mock("@/stores/song-store", () => ({
  useSongStore: { getState: () => ({ hydrateSongs: native.hydrateSongs }) },
}))
vi.mock("@/stores", () => ({
  useBibleStore: { getState: () => ({ setTranslations: native.setTranslations }) },
}))

const result = {
  report: {
    found: 3,
    imported: 2,
    updated: 0,
    skippedExisting: 1,
    failed: [{ item: "Broken.pro", reason: "no slide text found" }],
    templates: ["Sunday (OpenLP)"],
    templatesSkipped: [],
    songsLinked: 1,
  },
  bibles: [
    { translationId: null, title: "King James", abbreviation: "KJV", language: "en", status: "alreadyInManna", books: 66, verses: 31102, skippedBooks: [] },
    { translationId: 1000000, title: "World English", abbreviation: "WEB", language: "en", status: "imported", books: 66, verses: 31098, skippedBooks: [] },
  ],
}

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  vi.clearAllMocks()
  native.invoke.mockImplementation(async (command: string) => {
    if (command === "detect_import_sources")
      return [
        {
          kind: "openlp",
          path: "/Users/me/Library/Application Support/openlp",
          label: "OpenLP",
          contents: ["175 songs", "4 Bibles"],
        },
      ]
    if (command === "import_content") return result
    if (command === "list_translations") return []
  })
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

async function mount() {
  await act(async () => root.render(<ImportSection />))
}

it("lists libraries found on this computer with what they contain", async () => {
  await mount()
  expect(container.textContent).toContain("OpenLP")
  expect(container.textContent).toContain("175 songs · 4 Bibles")
})

it("imports a detected library and reports where everything went", async () => {
  await mount()
  const button = container.querySelector<HTMLButtonElement>('[aria-label="Import from OpenLP"]')!
  await act(async () => button.click())

  expect(native.invoke).toHaveBeenCalledWith("import_content", {
    paths: ["/Users/me/Library/Application Support/openlp"],
    overwrite: false,
  })
  expect(native.hydrateSongs).toHaveBeenCalled()
  expect(native.setTranslations).toHaveBeenCalled()
  const text = container.textContent ?? ""
  expect(text).toContain("Imported 2 songs, 1 plan template, 1 Bible")
  expect(text).toContain("Sunday (OpenLP)")
  expect(text).toContain("KJV — Already in Manna")
  expect(text).toContain("Broken.pro")
  expect(native.success).toHaveBeenCalled()
})

it("passes chosen files through and honours the replace switch", async () => {
  native.open.mockResolvedValue(["/tmp/Sunday.osz", "/tmp/Way Maker.pro"])
  await mount()
  const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')!
  await act(async () => toggle.click())
  const choose = [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Choose files")
  )!
  await act(async () => choose.click())
  expect(native.invoke).toHaveBeenCalledWith("import_content", {
    paths: ["/tmp/Sunday.osz", "/tmp/Way Maker.pro"],
    overwrite: true,
  })
})
