import { defineConfig } from "zfb/config";
import { zudoDoc } from "@takazudo/zudo-doc/config";

export default defineConfig(
  zudoDoc({
    // Dev/preview port: project convention reserves 152xx for docs sites
    // (the app dev server itself is 15200) — scaffold default is 4321.
    port: 15210,
    // Cloudflare Workers static-assets adapter — required so `zfb build`
    // emits `dist/_worker.js` for `wrangler deploy` (see doc/wrangler.toml).
    adapter: "@takazudo/zfb-adapter-cloudflare",
    siteName: "zudo-panel-designer docs",
    siteUrl: "https://doc-zudo-panel-designer.takazudomodular.com",
    locales: {
      ja: {
        label: "JA",
        dir: "src/content/docs-ja",
      },
    },
    githubUrl: "https://github.com/zudolab/zudo-panel-designer",
    llmsTxt: true,
    sidebarResizer: true,
    sidebarToggle: true,
    imageEnlarge: true,
    dynamicPageTransition: true,
    footer: {
      links: [],
      copyright: "Copyright © 2026 Takazudo. Built with zudo-doc.",
    },
    headerNav: [
      {
        label: "Overview",
        path: "/docs/overview",
        categoryMatch: "overview",
      },
      {
        label: "Document Model",
        path: "/docs/document-model",
        categoryMatch: "document-model",
      },
      {
        label: "Editor",
        path: "/docs/editor",
        categoryMatch: "editor",
      },
      {
        label: "Patterns",
        path: "/docs/patterns",
        categoryMatch: "patterns",
      },
      {
        label: "Export",
        path: "/docs/export",
        categoryMatch: "export",
      },
      {
        label: "Development",
        path: "/docs/development",
        categoryMatch: "development",
      },
    ],
    headerRightItems: [
      {
        type: "component",
        component: "github-link",
      },
      {
        type: "component",
        component: "theme-toggle",
      },
      {
        type: "component",
        component: "search",
      },
      {
        type: "component",
        component: "language-switcher",
      },
    ],
  }),
);
