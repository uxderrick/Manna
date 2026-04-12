import { useState, useRef, useEffect } from "react"
import { useTheme } from "@/components/theme-provider"
import { useSessionStore } from "@/stores"

type MenuItemDef =
  | { type: "separator" }
  | {
      type: "item"
      label: string
      shortcut?: string
      disabled?: boolean | (() => boolean)
      action: () => void
    }

interface MenuDef {
  label: string
  items: MenuItemDef[]
}

export function MenuBar() {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const menuBarRef = useRef<HTMLDivElement>(null)
  const { theme, setTheme } = useTheme()
  const activeSession = useSessionStore((s) => s.activeSession)

  const hasActiveSession = activeSession !== null
  const hasLiveSession = activeSession?.status === "live"

  const menus: MenuDef[] = [
    {
      label: "Manna",
      items: [
        { type: "item", label: "About Manna", action: () => {} },
        { type: "separator" },
        {
          type: "item",
          label: "Preferences…",
          shortcut: "⌘,",
          action: () => {},
        },
        { type: "separator" },
        {
          type: "item",
          label: "Quit Manna",
          shortcut: "⌘Q",
          action: () => {},
        },
      ],
    },
    {
      label: "Session",
      items: [
        {
          type: "item",
          label: "New Session…",
          shortcut: "⌘N",
          action: () => {},
        },
        {
          type: "item",
          label: "End Session",
          shortcut: "⌘⇧E",
          disabled: !hasLiveSession,
          action: () => {},
        },
        { type: "separator" },
        { type: "item", label: "Import Plan…", action: () => {} },
        {
          type: "item",
          label: "Export Notes…",
          shortcut: "⌘⇧X",
          disabled: !hasActiveSession,
          action: () => {},
        },
        {
          type: "item",
          label: "Distribute Summary…",
          disabled: !hasActiveSession,
          action: () => {},
        },
      ],
    },
    {
      label: "Broadcast",
      items: [
        { type: "item", label: "Go Live", shortcut: "⌘L", action: () => {} },
        {
          type: "item",
          label: "Go Off Air",
          shortcut: "⌘⇧L",
          action: () => {},
        },
        { type: "separator" },
        {
          type: "item",
          label: "New Announcement…",
          shortcut: "⌘⇧N",
          action: () => {},
        },
        { type: "separator" },
        {
          type: "item",
          label: "Theme Designer…",
          shortcut: "⌘T",
          action: () => {},
        },
      ],
    },
    {
      label: "View",
      items: [
        {
          type: "item",
          label: "Toggle Transcript",
          shortcut: "⌘J",
          action: () => {},
        },
        { type: "item", label: "Reset Layout", action: () => {} },
        { type: "separator" },
        {
          type: "item",
          label: theme === "dark" ? "Light Mode" : "Dark Mode",
          action: () => setTheme(theme === "dark" ? "light" : "dark"),
        },
      ],
    },
    {
      label: "Help",
      items: [
        { type: "item", label: "Tutorial", action: () => {} },
        {
          type: "item",
          label: "Keyboard Shortcuts",
          shortcut: "⌘/",
          action: () => {},
        },
        { type: "separator" },
        { type: "item", label: "Documentation", action: () => {} },
        { type: "item", label: "Report Issue", action: () => {} },
      ],
    },
  ]

  // Close dropdown when clicking outside the menu bar
  useEffect(() => {
    if (!openMenu) return

    const handleMouseDown = (e: MouseEvent) => {
      if (
        menuBarRef.current &&
        !menuBarRef.current.contains(e.target as Node)
      ) {
        setOpenMenu(null)
      }
    }

    document.addEventListener("mousedown", handleMouseDown)
    return () => document.removeEventListener("mousedown", handleMouseDown)
  }, [openMenu])

  const handleMenuButtonClick = (menuLabel: string) => {
    setOpenMenu((prev) => (prev === menuLabel ? null : menuLabel))
  }

  const handleMenuButtonMouseEnter = (menuLabel: string) => {
    if (openMenu !== null && openMenu !== menuLabel) {
      setOpenMenu(menuLabel)
    }
  }

  const handleItemClick = (item: MenuItemDef) => {
    if (item.type !== "item") return
    const isDisabled =
      typeof item.disabled === "function" ? item.disabled() : item.disabled
    if (isDisabled) return
    item.action()
    setOpenMenu(null)
  }

  return (
    <div
      ref={menuBarRef}
      className="h-[var(--menu-bar-height)] flex items-center bg-card/80 backdrop-blur-sm border-b border-border text-xs select-none shrink-0"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {menus.map((menu) => {
        const isOpen = openMenu === menu.label

        return (
          <div key={menu.label} className="relative">
            {/* Menu trigger button */}
            <button
              className={[
                "px-2.5 h-[var(--menu-bar-height)] flex items-center rounded-sm transition-colors duration-[var(--duration-fast)] cursor-default",
                isOpen
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              ].join(" ")}
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
              onClick={() => handleMenuButtonClick(menu.label)}
              onMouseEnter={() => handleMenuButtonMouseEnter(menu.label)}
            >
              {menu.label}
            </button>

            {/* Dropdown */}
            {isOpen && (
              <div
                className="absolute top-full left-0 mt-0.5 min-w-[200px] bg-popover border border-border rounded-md shadow-md p-1 z-50"
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
              >
                {menu.items.map((item, idx) => {
                  if (item.type === "separator") {
                    return <div key={idx} className="h-px bg-border my-1" />
                  }

                  const isDisabled =
                    typeof item.disabled === "function"
                      ? item.disabled()
                      : !!item.disabled

                  return (
                    <button
                      key={idx}
                      className={[
                        "w-full flex items-center justify-between px-2 py-1 rounded-sm text-xs text-popover-foreground transition-colors duration-[var(--duration-fast)] cursor-default",
                        isDisabled
                          ? "opacity-50 pointer-events-none"
                          : "hover:bg-accent hover:text-accent-foreground",
                      ].join(" ")}
                      disabled={isDisabled}
                      onClick={() => handleItemClick(item)}
                    >
                      <span>{item.label}</span>
                      {item.shortcut && (
                        <span className="text-[10px] text-muted-foreground ml-4">
                          {item.shortcut}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
