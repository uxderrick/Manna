import { resolveChurchAsset } from "@/lib/church-assets"
import { useState } from "react"
import { toast } from "sonner"
import { useSettingsStore, persistBrandConfig } from "@/stores/settings-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { givingSlide } from "@/lib/giving-slide"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

export function GivingDetails() {
  const brand = useSettingsStore((state) => state.brand)
  const [provider, setProvider] = useState(brand.givingProvider ?? "")
  const [number, setNumber] = useState(brand.givingNumber ?? "")
  const [name, setName] = useState(brand.givingAccountName ?? "")
  const [saving, setSaving] = useState(false)
  const preview = givingSlide({
    momoImagePath: null,
    givingProvider: provider,
    givingNumber: number,
    givingAccountName: name,
  })
  const dirty =
    provider !== (brand.givingProvider ?? "") ||
    number !== (brand.givingNumber ?? "") ||
    name !== (brand.givingAccountName ?? "")
  const save = async () => {
    setSaving(true)
    const saved = await persistBrandConfig({
      givingProvider: provider.trim(),
      givingNumber: number.trim(),
      givingAccountName: name.trim(),
      momoImagePath: null,
    })
    setSaving(false)
    if (!saved) {
      toast.error("Could not save giving details. Try again.")
      return
    }
    setProvider(provider.trim())
    setNumber(number.trim())
    setName(name.trim())
    useBroadcastStore.getState().syncBroadcastOutput()
    toast.success(
      "Giving details saved. The Giving slide now uses these details."
    )
  }
  return (
    <section aria-label="Giving details" className="space-y-4 border-t pt-5">
      <div>
        <h3 className="text-sm font-semibold">Giving details</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          These details appear on the Giving slide in your service plan. Saving
          replaces any selected giving image.
        </p>
      </div>
      <label className="block space-y-1.5 text-xs font-medium">
        Payment method
        <Input
          value={provider}
          onChange={(event) => setProvider(event.target.value)}
          maxLength={40}
          placeholder="e.g. MTN MoMo"
          disabled={saving}
        />
      </label>
      <label className="block space-y-1.5 text-xs font-medium">
        Payment number or account
        <Input
          value={number}
          onChange={(event) => setNumber(event.target.value)}
          maxLength={40}
          placeholder="Enter your church's payment number"
          disabled={saving}
        />
      </label>
      <label className="block space-y-1.5 text-xs font-medium">
        Account name
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={100}
          placeholder="Account holder"
          disabled={saving}
        />
      </label>
      <img
        src={resolveChurchAsset(preview.url)}
        alt="Giving slide preview"
        className="aspect-video w-full rounded-md border bg-black object-contain"
      />
      {brand.momoImagePath && (
        <p className="text-xs text-muted-foreground">
          Your current giving image is still selected. It stays unchanged until
          you save these details.
        </p>
      )}
      <Button
        size="sm"
        disabled={saving || (!dirty && !brand.momoImagePath)}
        onClick={() => void save()}
      >
        {saving ? "Saving…" : "Save giving details"}
      </Button>
    </section>
  )
}
