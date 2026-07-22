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
import {
  isGroupNode,
  serializePanelConfig,
  type DocState,
  type HistoryState,
  type Layer,
  type LayerNode,
  type PanelConfig,
} from '@zpd/core';
import type { Camera } from './camera';
import { projectFlatLayers } from './flat-projection';
import {
  fingerprintPreviewSurfaceMap,
  getPreviewDebugSummary,
  samplePreviewSurfaceMap,
} from './preview/debug-state';
import type { PreviewDebugSummary, PreviewSurfaceMaps } from './preview/contracts';
import type {
  PreviewSurfaceDebugFingerprint,
  PreviewSurfaceDebugSample,
} from './preview/debug-state';
import { peekTextGeometry, type TextGeometry } from './text-geometry';

export interface ZpdTestLayerSummary {
  id: string;
  type: Layer['type'];
  name: string;
  hidden: boolean;
}

// The tree view (#150): the e2e contract for group structure. `hidden` here
// is the node's OWN flag (raw tree state) — the folded ancestor-hidden view
// is what getLayers() exposes via the flat projection.
export type ZpdTestLayerTreeNode =
  | ({ kind: 'layer' } & ZpdTestLayerSummary)
  | { kind: 'group'; id: string; name: string; hidden: boolean; children: ZpdTestLayerTreeNode[] };

export interface ZpdTestBridge {
  getDoc(): DocState;
  getHistory(): HistoryState<DocState>;
  getLayers(): ZpdTestLayerSummary[];
  // Read-only structural view of doc.layers — see ZpdTestLayerTreeNode.
  getLayerTree(): ZpdTestLayerTreeNode[];
  getLayerCount(): number;
  getPanelHp(): number;
  // getSelectedId stays (existing specs read it): non-null only when exactly
  // one layer is selected. getSelectedIds is the multi-select view (#44).
  getSelectedId(): string | null;
  getSelectedIds(): string[];
  getCamera(): Camera | null;
  getPreview(): PreviewDebugSummary;
  samplePreviewSurface(
    map: keyof PreviewSurfaceMaps,
    normalizedX: number,
    normalizedY: number,
  ): PreviewSurfaceDebugSample | null;
  fingerprintPreviewSurface(map: keyof PreviewSurfaceMaps): PreviewSurfaceDebugFingerprint | null;
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
  getHistory(): HistoryState<DocState>;
  getSelectedId(): string | null;
  getSelectedIds(): readonly string[];
  getCamera(): Camera | null;
}

function summarizeTree(nodes: LayerNode[]): ZpdTestLayerTreeNode[] {
  return nodes.map((node) =>
    isGroupNode(node)
      ? {
          kind: 'group' as const,
          id: node.id,
          name: node.name,
          hidden: !!node.hidden,
          children: summarizeTree(node.children),
        }
      : { kind: 'layer' as const, id: node.id, type: node.type, name: node.name, hidden: !!node.hidden },
  );
}

export function installTestBridge(source: TestBridgeSource): void {
  if (typeof window === 'undefined' || !isTestContext()) return;
  window.__zpdTest = {
    getDoc: () => source.getDoc(),
    getHistory: () => source.getHistory(),
    getLayers: () =>
      projectFlatLayers(source.getDoc().layers).map((l) => ({
        id: l.id,
        type: l.type,
        name: l.name,
        hidden: !!l.hidden,
      })),
    getLayerTree: () => summarizeTree(source.getDoc().layers),
    // LEAF count (matches getLayers().length) — a group node is structure,
    // not a countable layer.
    getLayerCount: () => projectFlatLayers(source.getDoc().layers).length,
    getPanelHp: () => source.getDoc().panelHp,
    getSelectedId: () => source.getSelectedId(),
    getSelectedIds: () => [...source.getSelectedIds()],
    getCamera: () => source.getCamera(),
    getPreview: () => getPreviewDebugSummary(),
    samplePreviewSurface: (map, normalizedX, normalizedY) =>
      samplePreviewSurfaceMap(map, normalizedX, normalizedY),
    fingerprintPreviewSurface: (map) => fingerprintPreviewSurfaceMap(map),
    getTextGeometry: (id) => peekTextGeometry(id),
    serialize: () => serializePanelConfig(source.getDoc()),
  };
}
