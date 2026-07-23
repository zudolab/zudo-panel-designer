// Single shared factory for the app's first-load document and e2e fixtures.
// Ids are fixed literals (not mintId/Date.now/Math.random) so e2e snapshots
// of the default doc stay stable across runs.
import { PANEL_HEIGHT_MM, panelWidthMm } from './panel-sizes';
import { patternCoverGeometry } from './pattern-geometry';
import { createPcbLayerStack } from './palette';
import type { DocState } from './types';

export const DEFAULT_PANEL_HP = 12;

export function createDefaultDoc(hp: number = DEFAULT_PANEL_HP): DocState {
  return {
    panelHp: hp,
    layers: createPcbLayerStack({
      copper: [
        {
          id: 'layer-default-dot-grid',
          name: 'Dot grid',
          type: 'pattern',
          patternType: 'dot-grid',
          color: 1,
          params: { pitch: 5, radius: 1 },
          ...patternCoverGeometry({ widthMm: panelWidthMm(hp), heightMm: PANEL_HEIGHT_MM }),
        },
      ],
    }),
    guides: [],
  };
}
