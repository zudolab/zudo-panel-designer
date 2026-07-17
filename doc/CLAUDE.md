# Doc

Documentation site built with [zudo-doc](https://github.com/zudolab/zudo-doc) — a zfb-based documentation framework with MDX, Tailwind CSS v4, and Preact islands. This project is intentionally minimal: one config file (`zfb.config.ts`) plus markdown content — layout, chrome, and islands all ship from `@takazudo/zudo-doc` in `node_modules`.

## Tech Stack

- **zfb** — documentation build framework
- **MDX** — content format, authored under `src/content/`
- **Tailwind CSS v4** — via `@tailwindcss/vite`
- **Preact** — for interactive islands only (with compat mode for React API)
- **Shiki** — package-owned code highlighting with the configured light/dark theme pair
- **@takazudo/zudo-doc** — the package that owns everything: layout, chrome, islands, default `@theme` design tokens, and (via `packageOwnedRoutes`, on by default) the doc routes themselves

## Commands

- `pnpm dev` — zfb dev server (port 4321)
- `pnpm build` — static HTML export to `dist/`
- `pnpm check` — TypeScript type checking
- `pnpm preview` — serve the built `dist/`

## Key Directories

```
zfb.config.ts             # THE one config file — zudoDoc({ ...only fields you chose })
pages/
├── index.tsx             # 1-line re-export of the package home route
└── docs/[[...slug]].tsx  # self-contained doc-route stub (required for `pnpm dev`)
  [locale]/docs/[[...slug]].tsx  # same, for non-default locales
src/
├── chrome-bindings.tsx   # optional typed primary chrome / named header / MDX bindings
├── content/
│   └── docs/             # MDX content (this project's showcase docs)
│   └── docs-ja/         # Japanese MDX content (mirrors docs/)
└── styles/
    └── global.css        # @import chain + a token-override slot — that's it
```

Everything else — layout, header, sidebar, footer, doc chrome, islands, and the default design tokens — lives in `node_modules/@takazudo/zudo-doc`. For supported markup replacement, create `src/chrome-bindings.tsx` with `defineChromeBindings`, set `chromeBindingsModule`, and use the primary `Header` / `Footer` / `Sidebar` / `Toc` / `Breadcrumb` / `DocPager` slots or the named `headerRightComponents` registry. The generated default, locale, and doc-history route shapes already consume the same binding object; do not fork a route stub for presentational customization. `npx zudo-doc eject <component>` only copies source: heed its primary, nested-chrome, or content-layer remediation before expecting the copy to render. Settings you didn't set explicitly in `zfb.config.ts` use the package's documented defaults — hover `zudoDoc`'s `ZudoDocConfig` argument in your editor to see every field and its `@default`.

## Content Conventions

### Frontmatter

- Required: `title` (string)
- Optional: `description`, `sidebar_position` (number), `category`
- Sidebar order is driven by `sidebar_position`

### Admonitions

Available in all MDX files without imports, via directive syntax: `:::note`, `:::tip`, `:::info`, `:::warning`, `:::danger`, `:::caution`, `:::details`. Each accepts an optional `{title="..."}` attribute.

### Headings

Do NOT use h1 (`#`) in doc content — the page title from frontmatter is rendered as h1. Start content headings from h2 (`##`).

### Built-in MDX components

`@takazudo/zudo-doc` ships a few **globally-available MDX components** — usable in any `.mdx` file with **no import**. The seeded `getting-started/index.mdx` already uses one:

- `<CategoryNav category="..." />` — a card-grid list of the pages in a docs category (this is the one seeded into `getting-started/index.mdx`).
- `<CategoryTreeNav category="..." />` — the same listing as a compact nested tree, better for deeper hierarchies.
- `<SiteTreeNavDemo />` — a full-site documentation tree (the MDX-available wrapper of the `SiteTreeNav` island).

Admonitions (above), tabbed content (`<Tabs>` / `<TabItem>`, `<CodeGroup>`), and block math (`<MathBlock>`) work the same way — no import. Full reference: https://zudo-doc.takazudomodular.com/docs/components/

## i18n

- English (default): `/docs/...` — content in `src/content/docs/`
- Japanese: `/ja/docs/...` — content in `src/content/docs-ja/`
- Japanese docs should mirror the English directory structure
- Both `pages/docs/[[...slug]].tsx` and `pages/[locale]/docs/[[...slug]].tsx` are self-contained doc-route stubs shipped by the generator — required so `pnpm dev` doesn't 404 on doc pages (a zfb dev-mode limitation on package-injected dynamic routes). Don't delete them.

## Enabled Features

- **search** — Full-text search via Pagefind
- **sidebarResizer** — Draggable sidebar width
- **sidebarToggle** — Show/hide desktop sidebar
- **llmsTxt** — Generates llms.txt for LLM consumption
