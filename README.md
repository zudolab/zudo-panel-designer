# zpd — zudo-panel-designer

A web app for designing Takazudo Modular PCB blank panels. Lay out a panel in
the browser and download a versioned order JSON. Panels come in three fixed
finishes: **black**, **gold**, and **white**.

## Monorepo layout

- `packages/core` (`@zpd/core`) — document model, geometry/ops/history. No UI.
- `packages/patterns` (`@zpd/patterns`) — panel pattern definitions.
- `packages/app` (`@zpd/app`, private) — the Vite + React one-page app.

## Requirements

- Node.js >= 22
- pnpm (version pinned via `packageManager` — run via `corepack`)

## Dev commands

Run from the repo root:

- `pnpm install` — install all workspace dependencies.
- `pnpm dev` — start the app dev server at http://localhost:15200.
- `pnpm build` — build all packages (`pnpm -r build`).
- `pnpm typecheck` — typecheck all packages (`pnpm -r typecheck`).
- `pnpm lint` — lint the whole repo with ESLint.
- `pnpm format` — format the whole repo with Prettier.
- `pnpm test` — run the unit test suite with Vitest.

`_temp-resource/` holds a reference prototype only. It is excluded from all
lint/format/test/typecheck tooling and is not part of the workspace.
