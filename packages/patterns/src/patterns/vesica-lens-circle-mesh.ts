import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Ported from pgen `vesica-lens-circle-mesh` (see .claude/skills/port-pgen-patterns/).
// A square lattice of circle outlines whose radius equals the lattice pitch, so
// neighbouring circles overlap by half and their intersections read as vesica
// lenses (the flower-of-life mesh). Dropped from the source: bg fill and the
// per-circle random color offset — one flat stroke color per the zpd contract.
export const vesicaLensCircleMesh: PanelPatternGenerator = {
  name: 'vesica-lens-circle-mesh',
  displayName: 'Vesica Lens Circle Mesh',
  paramDefs: [
    { key: 'pitch', label: 'Pitch (mm)', min: 3, max: 20, step: 0.5, defaultValue: 7 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 0.45 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const pitch = resolveParam(params, this.paramDefs, 'pitch');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    // source relation: radius = cell (nodes one pitch apart → circles overlap by
    // half). A node just outside each edge always sits within one pitch, and its
    // radius=pitch circle reaches back to the edge, so the standard overscan is
    // enough to keep the mesh seamless.
    const radius = pitch;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    for (let y = centeredStart(heightMm, pitch); y <= heightMm + pitch; y += pitch) {
      for (let x = centeredStart(widthMm, pitch); x <= widthMm + pitch; x += pitch) {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  },
};
