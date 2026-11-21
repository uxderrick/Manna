import { resolveChurchAsset } from "@/lib/church-assets"
import type { ImageSlide } from "@/types"
import { CanvasVerse } from "@/components/ui/canvas-verse"
import { BUILTIN_THEMES } from "@/lib/builtin-themes"

export function PlanSlideThumbnail({
  image,
  live,
}: {
  image: ImageSlide
  live: boolean
}) {
  return (
    <div className="pointer-events-none relative aspect-video w-full overflow-hidden bg-black">
      {image.textOverlay ? (
        <div
          role="img"
          aria-label={`${image.label}: ${image.textOverlay.title}`}
        >
          <CanvasVerse
            theme={BUILTIN_THEMES[0]}
            verse={null}
            fullscreenImage={image}
          />
        </div>
      ) : (
        <img
          src={resolveChurchAsset(image.url)}
          alt={image.label}
          draggable={false}
          className="h-full w-full object-contain"
        />
      )}
      {live && (
        <span className="absolute top-2 right-2 flex items-center gap-1.5 rounded-full bg-red-600 px-2 py-1 text-[10px] font-semibold tracking-wide text-white uppercase">
          <span className="size-1.5 rounded-full bg-white" />
          Live
        </span>
      )}
    </div>
  )
}
