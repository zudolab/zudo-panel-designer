// Versioned config export — the stage-1 deliverable: the user downloads this
// JSON and orders a panel with it. Everything needed to reproduce the design
// deterministically must round-trip through here.
// hp + layer data are authoritative; panel dimensions and palette names are
// derived/advisory output. Image layers are design-time sources (dataURL),
// not manufacturable — the traced vector layers are the actual artwork.
import { PALETTE } from './palette';
import { PANEL_HEIGHT_MM, panelSizeByHp } from './panel-sizes';
import type { DocState } from './types';

export interface PanelConfigJson {
  version: 1;
  app: 'zpd';
  panel: { hp: number; widthMm: number; heightMm: number };
  palette: string[];
  layers: DocState['layers'];
}

export function serializeDoc(doc: DocState): string {
  const size = panelSizeByHp(doc.panelHp);
  const config: PanelConfigJson = {
    version: 1,
    app: 'zpd',
    panel: { hp: size.hp, widthMm: size.widthMm, heightMm: PANEL_HEIGHT_MM },
    palette: PALETTE.map((p) => p.name),
    layers: doc.layers,
  };
  return JSON.stringify(config, null, 2);
}

export function downloadDocJson(doc: DocState): void {
  const blob = new Blob([serializeDoc(doc)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `zpd-panel-${doc.panelHp}hp.json`;
  a.click();
  URL.revokeObjectURL(url);
}
