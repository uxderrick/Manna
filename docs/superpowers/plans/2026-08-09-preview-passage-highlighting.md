# Preview Passage Highlighting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let operators drag across words in the scripture preview, choose a color, and carry item-scoped highlights through queue/history into the live projector.

**Architecture:** Keep canvas rendering authoritative. Add pure annotation and hit-map utilities, make the verse renderer expose optional word geometry, and wrap the program preview in a narrowly scoped interactive component. Persist only a safe default color in Settings and attach annotation ranges to render payloads and verse queue items.

**Tech Stack:** React 19, TypeScript 5.9, Zustand 5, HTML Canvas 2D, Tauri Store, Vitest 4, Tailwind CSS 4.

## Global Constraints

- Canonical scripture text remains unchanged.
- Highlights belong only to the specific queue/history item that carries them.
- Direct pointer dragging occurs on the visual canvas preview.
- Preview, live monitor, projector, and NDI use the shared canvas renderer.
- Incompatible annotations are discarded rather than fuzzily remapped.
- Existing persisted data without annotations remains valid.
- Preserve unrelated working-tree changes.

## File Structure

- Create `src/lib/text-highlights.ts`: pure validation, apply, clear, and drag-range helpers.
- Create `src/lib/text-highlights.test.ts`: annotation behavior tests.
- Create `src/components/panels/interactive-verse-preview.tsx`: pointer selection and color toolbar.
- Modify `src/types/broadcast.ts`: shared highlight and word-hit-box types.
- Modify `src/types/queue.ts`: optional verse-item annotations.
- Modify `src/lib/verse-renderer.ts`: source-aware word layout, highlight geometry, and optional hit map.
- Modify `src/lib/verse-renderer.test.ts`: renderer geometry and validation coverage.
- Modify `src/components/ui/canvas-verse.tsx`: optional interaction result callback without changing non-interactive callers.
- Modify `src/components/panels/preview-panel.tsx`: use the interactive preview and item-owned draft annotations.
- Modify `src/hooks/use-broadcast.ts`: preserve annotations during queue/render conversion.
- Modify `src/stores/queue-store.ts`: update annotations on a specific verse item.
- Modify `src/stores/queue-store.test.ts`: item-scoped persistence coverage.
- Modify `src/stores/broadcast-store.test.ts`: live/history annotation propagation coverage.
- Create `src/components/settings/highlight-settings.tsx`: presentation palette setting.
- Modify `src/stores/settings-store.ts`: hydrate and persist `defaultHighlightColor`.
- Modify `src/components/settings-dialog.tsx`: register the presentation setting section.

---

### Task 1: Annotation range model and normalization

**Files:**
- Create: `src/lib/text-highlights.ts`
- Create: `src/lib/text-highlights.test.ts`
- Modify: `src/types/broadcast.ts`
- Modify: `src/types/queue.ts`

**Interfaces:**
- Produces: `TextHighlight`, `WordHitBox`, `validHighlights(text, highlights)`, `applyHighlight(text, highlights, next)`, `clearHighlightRange(text, highlights, range)`, and `rangeFromWordHits(anchor, focus)`.
- Consumes: plain segment text and inclusive/exclusive source offsets.

- [ ] **Step 1: Write failing tests for validation, newest-color precedence, clearing, and reverse drag**

```ts
expect(validHighlights("For God so loved", [
  { segmentIndex: 0, start: 4, end: 7, color: "#FACC15", sourceText: "God" },
  { segmentIndex: 0, start: 99, end: 100, color: "#FACC15", sourceText: "x" },
])).toHaveLength(1)

expect(applyHighlight("For God so loved", existing, {
  segmentIndex: 0, start: 4, end: 13, color: "#4ADE80", sourceText: "God so lo",
})).toEqual([
  { segmentIndex: 0, start: 0, end: 4, color: "#FACC15", sourceText: "For " },
  { segmentIndex: 0, start: 4, end: 13, color: "#4ADE80", sourceText: "God so lo" },
])
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm test --run src/lib/text-highlights.test.ts`

Expected: FAIL because `text-highlights.ts` and its exports do not exist.

- [ ] **Step 3: Implement immutable range validation and interval subtraction**

Use half-open intervals. Reject non-integer, empty, reversed, out-of-bounds, unsupported-color, wrong-segment, and `sourceText`-mismatched annotations. Applying a range subtracts its overlap from old ranges, inserts the new range, refreshes every surviving `sourceText`, and sorts by `segmentIndex/start/end`. Clearing performs subtraction without insertion.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm test --run src/lib/text-highlights.test.ts`

Expected: all annotation utility tests pass.

- [ ] **Step 5: Commit the isolated model**

```bash
git add src/types/broadcast.ts src/types/queue.ts src/lib/text-highlights.ts src/lib/text-highlights.test.ts
git commit -m "feat(presentation): add scripture highlight annotations"
```

### Task 2: Renderer word hit map and highlight geometry

**Files:**
- Modify: `src/lib/verse-renderer.ts`
- Modify: `src/lib/verse-renderer.test.ts`
- Modify: `src/components/ui/canvas-verse.tsx`

**Interfaces:**
- Consumes: `VerseRenderData.highlights?: TextHighlight[]` and `RenderOptions.collectWordHits?: boolean`.
- Produces: `RenderResult` containing layout metrics plus `wordHits: WordHitBox[]`; `CanvasVerse` accepts `onRenderResult?: (result: RenderResult | null) => void`.

- [ ] **Step 1: Add failing renderer tests**

Test a hand-measured monospace context where `measureText(text).width = text.length * 10`. Assert that wrapping `"For God so loved"` returns word boxes with exact source offsets `0..3`, `4..7`, `8..10`, and `11..16`; assert scale `0.5` halves coordinates; assert a valid `God` annotation produces one highlight rect behind the `God` hit; assert a source mismatch produces none.

- [ ] **Step 2: Run the renderer test and verify RED**

Run: `pnpm test --run src/lib/verse-renderer.test.ts`

Expected: FAIL because render results do not expose source-aware word hits or highlight rectangles.

- [ ] **Step 3: Implement one source-aware layout pass**

Tokenize each segment before display transforms, preserve source offsets, then compute wrapped line placement for left, center, right, justified, and centered-line modes. Paint normalized highlight rectangles before shadow/outline/text. Return word hit boxes only when requested. Keep `renderVerse` compatible for all existing callers and preserve unannotated output.

- [ ] **Step 4: Wire optional render results through `CanvasVerse`**

Invoke `onRenderResult` after every primary draw and image-triggered redraw. Reset it to `null` for blank-logo or fullscreen-image frames. Do not add pointer state to this shared component.

- [ ] **Step 5: Run focused renderer tests and typecheck**

Run: `pnpm test --run src/lib/verse-renderer.test.ts && pnpm typecheck`

Expected: renderer tests pass and TypeScript exits 0.

- [ ] **Step 6: Commit renderer support**

```bash
git add src/lib/verse-renderer.ts src/lib/verse-renderer.test.ts src/components/ui/canvas-verse.tsx
git commit -m "feat(presentation): render and hit-test passage highlights"
```

### Task 3: Queue, preview, live, and history propagation

**Files:**
- Modify: `src/hooks/use-broadcast.ts`
- Modify: `src/stores/queue-store.ts`
- Modify: `src/stores/queue-store.test.ts`
- Modify: `src/stores/broadcast-store.test.ts`

**Interfaces:**
- Produces: `queueVerseToRenderData(item)` copies only validated item annotations; `useQueueStore.updateVerseHighlights(id, highlights)` updates exactly one verse item.
- Consumes: optional annotations on `QueueItem` and `VerseRenderData`.

- [ ] **Step 1: Write failing item-ownership tests**

Create two queued items for the same canonical verse with different IDs. Apply a highlight to one ID and assert the other remains clean. Convert the annotated item and assert the render payload carries the annotation. Send it live and assert `liveVerse` and the newest history entry contain equal annotation values but do not mutate the original verse text.

- [ ] **Step 2: Run store tests and verify RED**

Run: `pnpm test --run src/stores/queue-store.test.ts src/stores/broadcast-store.test.ts`

Expected: FAIL because the store action and propagation are missing.

- [ ] **Step 3: Implement minimal propagation**

Add `updateVerseHighlights` as an immutable ID-targeted map. Validate annotations against `chunk.text` for split items or `verse.text` otherwise. Copy validated annotations in `queueVerseToRenderData`; let the existing broadcast history copy the resulting render payload.

- [ ] **Step 4: Run store tests and verify GREEN**

Run: `pnpm test --run src/stores/queue-store.test.ts src/stores/broadcast-store.test.ts src/hooks/use-broadcast.test.ts`

Expected: all focused propagation tests pass.

- [ ] **Step 5: Commit propagation**

```bash
git add src/hooks/use-broadcast.ts src/stores/queue-store.ts src/stores/queue-store.test.ts src/stores/broadcast-store.test.ts
git commit -m "feat(presentation): preserve item highlights through live output"
```

### Task 4: Direct canvas selection and color toolbar

**Files:**
- Create: `src/components/panels/interactive-verse-preview.tsx`
- Modify: `src/components/panels/preview-panel.tsx`

**Interfaces:**
- Consumes: `CanvasVerse.onRenderResult`, `defaultHighlightColor`, and an item-owned `VerseRenderData` draft.
- Produces: whole-word pointer selection, temporary selection painting, palette application, clear action, outside-click/Escape dismissal.

- [ ] **Step 1: Add failing pure drag-resolution cases to `text-highlights.test.ts`**

Assert a drag from the fourth word back to the second resolves to the second word's `start` and fourth word's `end`; assert a point outside all word boxes yields no range; assert movement between lines resolves in source order.

- [ ] **Step 2: Run the helper test and verify RED**

Run: `pnpm test --run src/lib/text-highlights.test.ts`

Expected: FAIL for missing point-to-hit and ordered drag behavior.

- [ ] **Step 3: Implement the interactive wrapper**

Use pointer capture on pointer-down. Resolve canvas-local coordinates against the latest word hit map. Keep `mode: "idle" | "selecting" | "choosing-color"` as the single interaction state. On pointer-up, anchor an absolutely positioned toolbar to the union of selected hit rectangles. Provide fixed palette buttons, a clear button, keyboard labels, Escape dismissal, and outside-click dismissal.

- [ ] **Step 4: Connect preview ownership**

When previewing a queue item, read/write that item's annotations through `updateVerseHighlights`. For an unqueued Bible selection, keep annotations in a local draft keyed by the exact selected verse identity and clear them when identity or translation changes. When that draft is queued or sent live, copy it into the created item/render payload.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `pnpm test --run src/lib/text-highlights.test.ts src/stores/queue-store.test.ts src/hooks/use-broadcast.test.ts && pnpm typecheck`

Expected: focused tests pass and TypeScript exits 0.

- [ ] **Step 6: Commit interaction**

```bash
git add src/components/panels/interactive-verse-preview.tsx src/components/panels/preview-panel.tsx src/lib/text-highlights.test.ts src/lib/text-highlights.ts
git commit -m "feat(presentation): select and highlight preview words"
```

### Task 5: Persistent default highlight color

**Files:**
- Create: `src/components/settings/highlight-settings.tsx`
- Modify: `src/stores/settings-store.ts`
- Modify: `src/components/settings-dialog.tsx`

**Interfaces:**
- Produces: `HIGHLIGHT_COLORS`, `DEFAULT_HIGHLIGHT_COLOR`, `isHighlightColor`, and `persistDefaultHighlightColor(color)`.
- Consumes: existing Tauri `settings.json` store and Settings section registry.

- [ ] **Step 1: Write a failing color-validation test in `text-highlights.test.ts`**

Assert every palette color is accepted, lowercase variants normalize to uppercase, and arbitrary CSS such as `url(...)`, `transparent`, or an unknown hex value falls back to `DEFAULT_HIGHLIGHT_COLOR`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm test --run src/lib/text-highlights.test.ts`

Expected: FAIL because palette validation/defaulting is absent.

- [ ] **Step 3: Implement setting hydration and persistence**

Add `defaultHighlightColor` to `SettingsState`, default it to `#FACC15`, hydrate only validated palette values, and persist through the shared Tauri store. Keep the in-memory value if persistence rejects.

- [ ] **Step 4: Add the settings UI**

Create a focused Presentation section with labeled color swatches, visible selected state, and explanatory copy. Register it in the existing Settings navigation without expanding `settings-dialog.tsx` with inline form markup.

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm test --run src/lib/text-highlights.test.ts && pnpm typecheck`

Expected: palette tests pass and TypeScript exits 0.

- [ ] **Step 6: Commit settings**

```bash
git add src/components/settings/highlight-settings.tsx src/components/settings-dialog.tsx src/stores/settings-store.ts src/lib/text-highlights.ts src/lib/text-highlights.test.ts
git commit -m "feat(settings): configure default passage highlight"
```

### Task 6: Regression and acceptance verification

**Files:**
- Modify only files needed to fix failures caused by Tasks 1-5.

**Interfaces:**
- Consumes: the complete feature.
- Produces: fresh evidence that highlighting does not regress existing presentation behavior.

- [ ] **Step 1: Run all unit tests**

Run: `pnpm test --run`

Expected: zero failed test files and zero failed tests.

- [ ] **Step 2: Run static verification**

Run: `pnpm typecheck && pnpm lint`

Expected: both commands exit 0.

- [ ] **Step 3: Run the production build**

Run: `pnpm build`

Expected: Vite exits 0 and emits the production bundles.

- [ ] **Step 4: Review the final diff against acceptance criteria**

Confirm the diff contains no canonical verse text mutation, no global per-reference annotation map, no changes to songs/images, and no unrelated user files. Confirm older optional fields default safely.

- [ ] **Step 5: Commit any verification-only fixes**

```bash
git add src/components/panels/interactive-verse-preview.tsx src/components/panels/preview-panel.tsx src/components/settings/highlight-settings.tsx src/components/settings-dialog.tsx src/components/ui/canvas-verse.tsx src/hooks/use-broadcast.ts src/lib/text-highlights.ts src/lib/text-highlights.test.ts src/lib/verse-renderer.ts src/lib/verse-renderer.test.ts src/stores/broadcast-store.test.ts src/stores/queue-store.ts src/stores/queue-store.test.ts src/stores/settings-store.ts src/types/broadcast.ts src/types/queue.ts
git commit -m "fix(presentation): harden passage highlighting"
```
