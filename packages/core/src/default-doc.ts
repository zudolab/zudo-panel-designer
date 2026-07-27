// Single shared factory for the app's first-load document and e2e fixtures.
// Ids are fixed literals (not mintId/Date.now/Math.random) so e2e snapshots
// of the default doc stay stable across runs.
import { panelHeightMm, type PanelFormat } from './panel-templates';
import { panelWidthMm } from './panel-sizes';
import { patternCoverGeometry } from './pattern-geometry';
import { createPcbLayerStack } from './palette';
import type { DocState, PcbMaterial } from './types';

export const DEFAULT_PANEL_HP = 12;
export const DEFAULT_PANEL_FORMAT: PanelFormat = '3U';
export const DEFAULT_PCB_MATERIAL: PcbMaterial = 'fr4';

export function createDefaultDoc(hp: number = DEFAULT_PANEL_HP): DocState {
  return {
    panelHp: hp,
    format: DEFAULT_PANEL_FORMAT,
    material: DEFAULT_PCB_MATERIAL,
    layers: createPcbLayerStack('front', {
      copper: [
        {
          id: 'layer-default-dot-grid',
          name: 'Dot grid',
          type: 'pattern',
          patternType: 'dot-grid',
          color: 1,
          params: { pitch: 5, radius: 1 },
          ...patternCoverGeometry({
            widthMm: panelWidthMm(hp),
            heightMm: panelHeightMm(DEFAULT_PANEL_FORMAT),
          }),
        },
      ],
    }),
    backLayers: createPcbLayerStack('back'),
    guides: [],
  };
}
