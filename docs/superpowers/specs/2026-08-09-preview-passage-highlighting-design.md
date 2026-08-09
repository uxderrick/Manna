# Preview Passage Highlighting

## Purpose

Allow an operator to drag across words in the visual scripture preview, choose a highlight color, and reproduce that highlight on the live presentation. Highlighting is presentation metadata and must never rewrite canonical Bible text.

This design covers scripture highlighting only. General text editing, bold, italic, prayer slides, and sacred-name capitalization are outside this change.

## Confirmed Product Decisions

1. Operators select words by dragging directly across the rendered visual preview.
2. Releasing a valid selection opens a compact color toolbar near the selection.
3. The application has a persistent default highlight color configured in Settings.
4. Highlights belong to a specific queued or history item. Looking up the same scripture again creates a clean presentation with no inherited highlights.
5. Preview and projector output must use the same rendering rules.
6. Canonical scripture text remains unchanged.

## Interaction Design

The preview remains canvas-based. While the pointer is down, the preview tracks the first and last word touched and displays a temporary selection treatment. Selection snaps to complete rendered words so character ranges cannot bisect a glyph.

When the pointer is released:

- An empty drag does nothing.
- A valid word range opens a compact toolbar adjacent to the selected range.
- The toolbar presents a small fixed palette and initially focuses the configured default color.
- Choosing a color applies it and closes the toolbar.
- The toolbar includes a clear action for removing highlighting from the selected range.
- Escape or clicking outside dismisses the toolbar without changing annotations.

Existing highlighted words may be dragged over and recolored or cleared. Overlapping ranges are normalized into non-overlapping render spans, with the most recently applied color winning within the new selection.

## Architecture

### Annotation model

Add presentation annotations to scripture render data and scripture queue items. Each annotation records:

```ts
interface TextHighlight {
  segmentIndex: number
  start: number
  end: number
  color: string
  sourceText: string
}
```

`start` is inclusive and `end` is exclusive. Offsets address the original, untransformed segment text. `sourceText` is the exact annotated substring and acts as a safety check when persisted data is restored or scripture text changes.

Annotations are optional for backward compatibility. Missing annotations mean an unhighlighted presentation.

### Renderer hit map

The existing canvas verse renderer remains authoritative. Its layout pass will expose a word hit map containing each rendered word's rectangle and source range. Preview interaction consumes this hit map; it does not recreate wrapping in HTML.

The hit map uses preview display coordinates after scaling. It is returned only when requested so projector and thumbnail callers do not retain unnecessary interaction data.

### Rendering

The renderer validates and normalizes annotations before drawing. For each rendered line, it paints highlight rectangles behind the affected word spans, then draws the existing verse text above them. Rectangle size follows the actual font metrics and line height, with modest padding and rounded corners.

The same annotation-aware renderer is used by:

- program preview
- live-output monitor
- projector windows
- NDI frame rendering

This prevents preview/projector drift.

### Preview interaction boundary

Selection state stays inside a dedicated interactive preview component rather than the general-purpose `CanvasVerse`. `CanvasVerse` continues to serve non-interactive theme thumbnails and monitors. The interactive wrapper owns pointer capture, temporary selection, toolbar positioning, and annotation callbacks while delegating layout and painting to shared canvas utilities.

## Data Flow

1. A scripture is selected or a specific queue/history item is reopened.
2. The preview builds `VerseRenderData`, including that item's annotations when present.
3. The renderer returns word hit boxes for the displayed verse.
4. Pointer dragging resolves the touched boxes to one source range.
5. Choosing a toolbar color normalizes the new annotation into the preview draft and updates the owning queue/history item.
6. Going live copies the annotated render payload into `liveVerse`.
7. Broadcast synchronization emits that payload unchanged to projector outputs.
8. The projector renderer paints the same ranges with the same colors.

A plain Bible lookup has no owning persisted item and begins with an empty annotation list. If it is queued or sent live, its current preview annotations are copied into the newly created item rather than associated globally with the canonical verse.

## Queue and History Ownership

Verse queue items gain an optional annotations field. Queue persistence must accept older items that omit it. Split-verse chunks own annotations against their chunk text, not the unsplit full verse.

Broadcast history already stores render payloads, so annotations travel with the historical render data. Reopening a history entry restores its exact presentation annotations.

Deleting, reordering, or presenting an item must not detach its annotations. Songs, images, notes, and other queue types remain unchanged.

## Translation and Text Safety

Annotation offsets are valid only for the exact source text from which they were created.

When translation or chunk text changes:

- Validate every annotation against segment bounds and `sourceText`.
- Discard any annotation whose substring no longer matches exactly.
- Never apply old offsets to newly translated text.
- Never write formatted text back into Bible or queue verse text.

This first version intentionally discards incompatible annotations rather than attempting fuzzy remapping.

## Settings

Add a presentation setting for `defaultHighlightColor`. It uses a fixed safe palette shared with the toolbar and persists through the existing Tauri settings store. Invalid or legacy values fall back to the product default.

The setting controls toolbar focus and the suggested choice; it does not apply a color automatically when dragging ends.

## Error Handling

- Ignore invalid, empty, reversed, out-of-bounds, or source-mismatched annotation ranges.
- If the hit map is unavailable, keep preview rendering functional and disable selection for that frame.
- Dismissing the toolbar does not create an annotation.
- A broadcast payload without annotations renders exactly as it does today.
- Settings persistence failure keeps the in-memory choice for the current session and follows existing settings error reporting.

## Testing

Use test-driven development for each behavior slice.

Pure tests cover:

- annotation validation and source-text checks
- overlapping-range normalization and newest-color precedence
- clear-range subtraction
- hit testing and drag range resolution
- scaled word rectangles and wrapped lines
- split-chunk offset ownership

Store and conversion tests cover:

- queue item annotation persistence
- clean annotations for a fresh lookup of the same verse
- copying annotations into preview, live payload, and history
- backward compatibility when annotations are absent
- discarding annotations after translated text changes

Renderer tests cover highlight geometry independently of canvas pixel snapshots. Existing unannotated renderer behavior remains unchanged.

## Acceptance Criteria

- Dragging across preview words opens a color toolbar near the selected range.
- Choosing a color highlights the selected complete words in preview.
- Sending the item live displays the same highlight on the projector and live monitor.
- Clearing a selected range restores the original visual text.
- Canonical verse text remains byte-for-byte unchanged.
- Multiple ranges and colors render predictably.
- Reopening the exact queue/history item restores its highlights.
- Looking up the same scripture independently does not restore another item's highlights.
- The default toolbar color can be changed in Settings and survives restart.
- Translation or text changes cannot attach an old highlight to different words.
- Old persisted queue and broadcast data without annotations continue to load.

## Out of Scope

- Editing scripture wording
- Bold, italic, underline, or text-color annotations
- Freehand canvas drawing
- Cross-segment selections spanning multiple verses
- Fuzzy annotation remapping after translation changes
- Global per-reference highlight memory
- Prayer-point editing and prayer presentation
