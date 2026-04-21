import { useState } from "react"
import { PlusIcon } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { useServicePlan } from "@/hooks/use-service-plan"

export function AddItemMenu() {
  const { addItem } = useServicePlan()
  const [open, setOpen] = useState(false)

  const addSection = async () => {
    await addItem("section", { type: "section", label: "New Section" })
    setOpen(false)
  }
  const addAnnouncement = async () => {
    await addItem("announcement", {
      type: "announcement",
      title: "New Announcement",
      body: "",
    })
    setOpen(false)
  }
  const addBlank = async () => {
    await addItem("blank", { type: "blank", showLogo: false })
    setOpen(false)
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <PlusIcon className="size-3.5" />
          Add
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={addSection}>Section header</DropdownMenuItem>
        <DropdownMenuItem onClick={addAnnouncement}>Announcement</DropdownMenuItem>
        <DropdownMenuItem onClick={addBlank}>Blank / logo</DropdownMenuItem>
        <DropdownMenuItem disabled>
          Verse — use queue or detection
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          Song — drag from Songs tab
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
