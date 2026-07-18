// Read-only window bridge for e2e assertions (Wave 6, #13). Canvas output is
// pixels — a Playwright test can't ask "did the rect move?" by inspecting the
// DOM, so this exposes the live doc/selection/camera instead. Read-only by
// design: tests observe state through here, they never mutate through it —
// every state change still goes through the real UI (clicks, drags, keys).
//
// Gated to dev/e2e contexts so it's a no-op in a normal production visit:
// import.meta.env.DEV covers `vite dev`, and the `?e2e=1` query flag covers
// the Playwright suite, which runs against a production `vite build` +
// `vite preview` (see playwright.config.ts) where DEV is false.
import { serializePanelConfig, type DocState, type Layer, type PanelConfig } from '@zpd/core';
import type { Camera } from './camera';
import { peekTextGeometry, type TextGeometry } from './text-geometry';

export interface ZpdTestLayerSummary {
  id: string;
  type: Layer['type'];
  name: string;
  hidden: boolean;
}

export interface ZpdTestBridge {
  getDoc(): DocState;
  getLayers(): ZpdTestLayerSummary[];
  getLayerCount(): number;
  getPanelHp(): number;
  // getSelectedId stays (existing specs read it): non-null only when exactly
  // one layer is selected. getSelectedIds is the multi-select view (#44).
  getSelectedId(): string | null;
  getSelectedIds(): string[];
  getCamera(): Camera | null;
  getTextGeometry(id: string): TextGeometry | null;
  serialize(): PanelConfig;
}

declare global {
  interface Window {
    __zpdTest?: ZpdTestBridge;
  }
}

function isTestContext(): boolean {
  if (import.meta.env.DEV) return true;
  // A real `?e2e` flag only — not any URL that merely contains the substring
  // "e2e" (e.g. `?ref=free2eat`), which the old includes() check let through.
  return typeof location !== 'undefined' && new URLSearchParams(location.search).has('e2e');
}

export interface TestBridgeSource {
  getDoc(): DocState;
  getSelectedId(): string | null;
  getSelectedIds(): readonly string[];
  getCamera(): Camera | null;
}

export function installTestBridge(source: TestBridgeSource): void {
  if (typeof window === 'undefined' || !isTestContext()) return;
  window.__zpdTest = {
    getDoc: () => source.getDoc(),
    getLayers: () =>
      source.getDoc().layers.map((l) => ({
        id: l.id,
        type: l.type,
        name: l.name,
        hidden: !!l.hidden,
      })),
    getLayerCount: () => source.getDoc().layers.length,
    getPanelHp: () => source.getDoc().panelHp,
    getSelectedId: () => source.getSelectedId(),
    getSelectedIds: () => [...source.getSelectedIds()],
    getCamera: () => source.getCamera(),
    getTextGeometry: (id) => peekTextGeometry(id),
    serialize: () => serializePanelConfig(source.getDoc()),
  };
}
