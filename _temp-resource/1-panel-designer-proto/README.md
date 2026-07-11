# panel-designer-proto — reference prototype for ZPD Stage 1

Working full-surface prototype built during planning (epic issue 1). Browser-verified
end-to-end. **Reference only — port/improve into `packages/*`, don't import from here.**
This directory is excluded from repo lint/format/test/typecheck and is deleted before
the epic's root PR merges.

## What it demonstrates

- mm document space; camera `{pxPerMm, offsetX, offsetY}` (wheel-zoom at pointer,
  zoom tool with Alt-click out, space-drag pan, fit) — `src/camera.ts`
- Canvas-2D full-repaint renderer for all 5 layer types + selection chrome +
  pattern thumbnails — `src/renderer.ts`
- Bezier pen tool (click/drag anchors, close via first-anchor click or the
  "Close path" button, Enter/Esc) + node editing (drag anchors/handles, Alt
  breaks mirroring) — `src/app.tsx`, `src/path-geometry.ts`
- Text layers with Google Fonts loaded at runtime (production must switch to
  pinned self-hosted `@fontsource/*` packages) — `src/fonts.ts`
- Image add + trace-to-vector with fixed-palette quantization and compound
  paths (`extraSubpaths` + evenodd — holes stay holes) — `src/trace.ts`,
  `src/components/trace-dialog.tsx`
- Pattern picker dialog with rendered static thumbnails — `src/components/pattern-dialog.tsx`
- Reducer undo/redo (one gesture = one entry) — `src/history.ts`
- Versioned JSON download — `src/serialize.ts`

## Known prototype-level shortcuts (fix in production)

- Trace color mapping uses plain RGB distance — production uses OKLab
  (see the trace sub-issue)
- Fonts fetched from Google at runtime — production self-hosts via @fontsource
- Monolithic `app.tsx` — production decomposes through tool/inspector registries
  (see the app-shell sub-issue)

## Hard-won gotchas encoded here (do not re-learn)

- `svg-pathdata`: call `.normalizeHVZ(false)` — the default rewrites `Z` into
  line-tos and the closed flag is lost
- The tracer's SVG may carry dimensions in `viewBox` only (not width/height attrs)
- One PathLayer per traced color region with evenodd — splitting subpaths into
  separate solid layers fills the donut holes
- Keep React state updaters pure — no commit/setState inside another updater
- Canvas e2e needs real trusted input (Playwright mouse), not synthetic
  PointerEvents; guard `setPointerCapture` with try/catch

## Run

```bash
pnpm install   # standalone — not part of the workspace
pnpm dev       # http://localhost:15100
```

`proto-e2e.mjs` / `verify-round3.mjs` are the trusted-input Playwright scripts used
for verification (they reference a machine-local playwright install; adapt paths).
