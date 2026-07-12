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
- `pnpm deploy` — build output must exist already; deploys `packages/app/dist`
  to Cloudflare Workers as static assets (`wrangler deploy --env production`).
- `pnpm deploy:dry` — validate `wrangler.toml` without deploying (`wrangler
  deploy --dry-run --env production`); needs no Cloudflare credentials.

`_temp-resource/` holds a reference prototype only. It is excluded from all
lint/format/test/typecheck tooling and is not part of the workspace.

## Deployment

The app is deployed as **Cloudflare Workers static assets** (not Cloudflare
Pages) — the same model as the takazudomodular.com main site. Config lives in
`wrangler.toml` at the repo root; `.github/workflows/production-deploy.yml`
builds and runs `wrangler deploy --env production` on every push to `main`.
`.github/workflows/pr-checks.yml` also runs a secret-free `wrangler deploy
--dry-run --env production` on every PR to catch config mistakes early.

### One-time manual setup (repo owner only)

An agent cannot perform these steps — they require access to the GitHub repo
settings and the Cloudflare dashboard:

1. **Add repo secrets** (Settings → Secrets and variables → Actions):
   - `CLOUDFLARE_API_TOKEN` — a Cloudflare API token with at least
     **Account → Workers Scripts → Edit** permission (and **Zone → Workers
     Routes → Edit** for the custom-domain route below).
   - `CLOUDFLARE_ACCOUNT_ID` — the Cloudflare account ID that owns the
     `zpd` Worker.
2. **Confirm the custom domain** in the Cloudflare dashboard: the
   `zpd.takazudomodular.com` hostname must resolve as a zone on the same
   Cloudflare account referenced above. `wrangler.toml` sets
   `custom_domain = true` for this route on the `production` environment, so
   Cloudflare creates and manages the DNS record and TLS certificate
   automatically on the first successful `wrangler deploy --env production`
   — no manual DNS record needs to be created ahead of time, but the domain
   must already be an active zone in that Cloudflare account.

Until both steps are done, `production-deploy.yml` will fail at the deploy
step (missing/invalid credentials) even though the build succeeds. The
`wrangler-dry-run` job in `pr-checks.yml` does not need either step and stays
green regardless.
