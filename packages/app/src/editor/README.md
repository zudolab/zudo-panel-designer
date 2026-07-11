# Editor architecture — the Wave-5 extension contract

The editor shell (`Editor.tsx`) owns only generic state: the document (with
undo/redo history), the camera, the current selection, and which tool is
active. Everything domain-specific — how a tool reacts to input, how a layer
type is inspected, what a dialog shows, what an "add …" button does — lives in a
**self-registering module** discovered at load time.

This is what lets multiple later waves add tools/inspectors/dialogs **in
parallel without merge conflicts**: each is a NEW file, and no existing file is
edited to hook it up.

## How discovery works

`registry/index.ts` runs, once, at import:

```ts
import.meta.glob('../tools/*.{ts,tsx}', { eager: true });
import.meta.glob('../inspectors/*.{ts,tsx}', { eager: true });
import.meta.glob('../add-actions/*.{ts,tsx}', { eager: true });
import.meta.glob('../dialogs/*.{ts,tsx}', { eager: true });
```

Eagerly importing every file in those folders executes each file's top-level
`register*()` call. **Do not** replace these globs with a hand-maintained import
list, and **do not** introduce a shared array/switch that every wave must edit —
that shared edit point is exactly what this design removes.

Verify it yourself: drop a new file into `tools/` that calls `registerTool(...)`
and it appears in the toolbar with zero edits elsewhere.

## Adding a tool

Create `tools/my-tool.tsx`:

```ts
import { registerTool } from '../registry/tools';

registerTool({
  id: 'my-tool',
  label: 'My Tool',
  shortcut: 'm', // optional; single key, matched case-insensitively
  cursor: 'crosshair', // optional CSS cursor while active
  onPointerDown(e, ctx) {
    /* e: ToolPointerEvent (screen px + doc mm), ctx: ToolContext */
  },
  onPointerMove(e, ctx) {},
  onPointerUp(e, ctx) {},
  onKeyDown(e, ctx) {
    // return true to mark handled and stop app-level fallbacks — this is how a
    // tool owns Enter/Esc without editing any global keyboard switch
    return false;
  },
  renderDraft(draft, ctx) {
    // draw an in-progress preview (e.g. the pen path) on top of the scene.
    // draft.inMmSpace(() => { ... }) runs with 1 unit == 1mm, like the layers.
  },
  onActivate(ctx) {},
  onDeactivate(ctx) {},
});
```

Keep any cross-event gesture state (a pen draft, a drag origin) in **module
scope** inside your tool file — there is only ever one active gesture. Call
`ctx.requestRepaint()` when that draft state changes so `renderDraft` re-runs.
See `tools/select.tsx` for the full pattern (hit-test, one-undo-entry gestures
via `beginGesture` + streamed `replace`, screen↔mm conversion).

### `ctx` (ToolContext) essentials

- `ctx.doc`, `ctx.camera`, `ctx.selectedId`, `ctx.selectedLayer` — LIVE reads.
- `ctx.toMm(screen)` / `ctx.toScreen(mm)` — coordinate conversion.
- `ctx.commit(next)` — one atomic change = one undo entry.
- `ctx.beginGesture()` then streamed `ctx.replace(next)` — a whole drag = one
  undo entry.
- `ctx.select(id)`, `ctx.setActiveTool(id)`, `ctx.setCamera(next)`.
- `ctx.openDialog(id, props)` / `ctx.closeDialog()`.

## Adding an inspector

Create `inspectors/my-type.tsx` and `registerInspector('shape', MyInspector)`.
The inspector gets `{ layer, onChange, ctx }`; call
`onChange(patch, { commit })` — `commit: false` while scrubbing a slider,
`commit: true` (the default) for a discrete edit.

## Adding an add-action

Create `add-actions/add-thing.ts` and `registerAddAction({ id, label, icon,
run(ctx) })`. It shows up on the left toolbar's add section automatically.

## Adding a dialog

Create `dialogs/my-dialog.tsx` and `registerDialog({ id, component })`. The
component gets `{ props, close, ctx }`. Open it from anywhere with
`ctx.openDialog('my-dialog', props)`.

## Keyboard routing order

The global handler routes each keydown to the **active tool's `onKeyDown`
first**. Only if the tool does not return `true` do the app-level fallbacks run
(tool shortcuts, undo/redo, delete, arrow-nudge, Esc). So a tool's Enter/Esc/
draft handling stays inside its own module — later waves never touch a shared
switch.
