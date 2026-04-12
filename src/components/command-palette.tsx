import { useEffect, useState, useMemo } from "react"
import {
  CommandDialog,
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "@/components/ui/command"
import type { AppCommand, CommandGroup as CommandGroupType } from "@/lib/command-registry"

const GROUP_ORDER: CommandGroupType[] = [
  "Session",
  "Broadcast",
  "View",
  "Navigate",
  "Help",
  "Manna",
]

interface CommandPaletteProps {
  commands: AppCommand[]
}

export function CommandPalette({ commands }: CommandPaletteProps) {
  const [open, setOpen] = useState(false)

  // Cmd+K to open
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])

  // Group commands by their group field
  const grouped = useMemo(() => {
    const map = new Map<CommandGroupType, AppCommand[]>()
    for (const cmd of commands) {
      const list = map.get(cmd.group) ?? []
      list.push(cmd)
      map.set(cmd.group, list)
    }
    return GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({
      group: g,
      commands: map.get(g)!,
    }))
  }, [commands])

  function handleSelect(command: AppCommand) {
    const isEnabled = command.enabled ? command.enabled() : true
    if (!isEnabled) return
    command.execute()
    setOpen(false)
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <Command>
        <CommandInput placeholder="Type a command or search…" />
        <CommandList>
          <CommandEmpty>No commands found.</CommandEmpty>
          {grouped.map(({ group, commands: cmds }) => (
            <CommandGroup key={group} heading={group}>
              {cmds.map((cmd) => {
                const isEnabled = cmd.enabled ? cmd.enabled() : true
                return (
                  <CommandItem
                    key={cmd.id}
                    value={`${cmd.group} ${cmd.label}`}
                    disabled={!isEnabled}
                    onSelect={() => handleSelect(cmd)}
                  >
                    <span>{cmd.label}</span>
                    {cmd.shortcut && (
                      <CommandShortcut>{cmd.shortcut}</CommandShortcut>
                    )}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
