# zpd — zudo-panel-designer

A web app for designing Takazudo Modular PCB blank panels. Lay out a panel in
the browser and download a versioned order JSON. Panels come in three fixed
finishes: **black**, **gold**, and **white**.

The editor gives you a tool palette with hover tooltips, a collapsible
card-panel sidebar (view options, panel size, palette, layers, align &
distribute, properties, and a per-tool help footer), and mm rulers framing the
canvas. The Select tool is a full multi-selection vector editor —
marquee-select, move, rotate, resize, and edit path anchors — with ruler
guides you drag out of the rulers and snap to, and a "show content outside the
panel" view option (on by default) that ghosts anything spilling past the
panel edge so it stays visible instead of clipped. A browser-zoom guard keeps
the canvas from desyncing under pinch/`⌘`+wheel/`⌘`+`+`/`-` page zoom.

Text layers pick from a small curated, self-hosted font set or the full
1,942-family Google Fonts catalog via a searchable Explorer modal (with a
Japanese-subset filter and starrable favorites). The document autosaves to
`localStorage` continuously — a save-status chip in the header reports
saved/unsaved/failed, and a **New panel** action resets to a fresh document.
Panel config JSON round-trips both ways: download to export, and import via a
header button, drag-and-drop anywhere on the page, or the command palette —
the same drop target also accepts an image file as a new layer. Multi-selections
support copy/cut/duplicate/select-all with a versioned clipboard envelope that
round-trips through the real OS clipboard across tabs, plus align/distribute
against either the selection or the whole panel. Most shortcuts (and every
palette-only, chordless action like New Panel and Align) are driven by one
contextual command registry, browsable through a searchable `?` shortcuts
overlay and a fuzzy `⌘/Ctrl+Shift+K` command palette — a few gestures with
their own native event source, like paste and arrow-key nudging, are listed
there too but dispatched by their own dedicated code.

Full behavior is covered in the
[doc site](https://doc-zudo-panel-designer.takazudomodular.com/).

## Monorepo layout

- `packages/core` (`@zpd/core`) — document model, geometry/ops/history. No UI.
- `packages/patterns` (`@zpd/patterns`) — panel pattern definitions.
- `packages/app` (`@zpd/app`, private) — the Vite + React one-page app.
- `doc/` — the documentation site, an isolated pnpm sub-project with its own
  lockfile (not part of the root workspace). See the Deployment section below.

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
- `pnpm deploy` — build output must exist already; deploys `packages/app/dist`
  to Cloudflare Workers as static assets (`wrangler deploy --env production`).
- `pnpm deploy:dry` — validate `wrangler.toml` without deploying (`wrangler
deploy --dry-run --env production`); needs no Cloudflare credentials.

`_temp-resource/` holds a reference prototype only. It is excluded from all
lint/format/test/typecheck tooling and is not part of the workspace.

## Deployment

Both the app and the docs site are deployed as **Cloudflare Workers static
assets** (not Cloudflare Pages) — the same model as the takazudomodular.com
main site:

- **App** — `https://zudo-panel-designer.takazudomodular.com/`. Config lives
  in `wrangler.toml` at the repo root (Worker `zudo-panel-designer`).
- **Doc site** — `https://doc-zudo-panel-designer.takazudomodular.com/`.
  Config lives in `doc/wrangler.toml` (Worker `doc-zudo-panel-designer`).

`.github/workflows/production-deploy.yml` runs two independent jobs
(`deploy-app`, `deploy-doc`) on every push to `main` — each builds and runs
`wrangler deploy --env production` for its own Worker, with a retry-guarded
deploy step and a post-deploy smoke check. It can also be triggered manually
via `workflow_dispatch` for a redeploy without a new commit.

### The `doc/` sub-site

`doc/` is an isolated pnpm sub-project with its own lockfile — it is not part
of the root pnpm workspace and is built and deployed independently of
`packages/*`. It is a [zudo-doc](https://github.com/zudolab/zudo-doc)
documentation site (see `doc/CLAUDE.md`), built with `pnpm build` from inside
`doc/` and deployed to the `doc-zudo-panel-designer` Worker.

### PR previews

`.github/workflows/pr-checks.yml` runs a secret-free `wrangler deploy
--dry-run --env production` on every PR to catch config mistakes early, and
also publishes a live preview: `wrangler versions upload --env preview
--preview-alias pr-N` uploads a preview version aliased to the PR number
(`zudo-panel-designer-preview`), and a sticky PR comment is updated with the
resulting preview URL on every push to the PR branch.

### One-time manual setup (repo owner only)

An agent cannot perform these steps — they require access to the GitHub repo
settings and the Cloudflare dashboard:

1. **Add repo secrets** (Settings → Secrets and variables → Actions):
   - `CLOUDFLARE_API_TOKEN` — a Cloudflare API token with at least
     **Account → Workers Scripts → Edit** permission (and **Zone → Workers
     Routes → Edit** for the custom-domain routes below).
   - `CLOUDFLARE_ACCOUNT_ID` — the Cloudflare account ID that owns the
     `zudo-panel-designer-production` and `doc-zudo-panel-designer-production`
     Workers (and their `-preview` counterparts).
2. **Confirm the custom domains** in the Cloudflare dashboard: both
   `zudo-panel-designer.takazudomodular.com` and
   `doc-zudo-panel-designer.takazudomodular.com` must resolve as zones on the
   same Cloudflare account referenced above. Each `wrangler.toml` sets
   `custom_domain = true` for its route on the `production` environment, so
   Cloudflare creates and manages the DNS record and TLS certificate
   automatically on the first successful `wrangler deploy --env production`
   — no manual DNS record needs to be created ahead of time, but the domain
   must already be an active zone in that Cloudflare account.

Until both steps are done, `production-deploy.yml` will fail at the deploy
step (missing/invalid credentials) even though the build succeeds. The
`wrangler-dry-run` job in `pr-checks.yml` does not need either step and stays
green regardless.
