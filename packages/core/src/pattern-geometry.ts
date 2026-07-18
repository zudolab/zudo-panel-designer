// Cover-default placement for a pattern layer's square (#96): side = the
// larger panel dimension, centered on the panel, so the square fully covers
// the panel at any aspect ratio (every current panel is taller than wide, so
// size = PANEL_HEIGHT_MM = 128.5). SINGLE source of truth for this formula —
// used by createDefaultDoc, the serialization migration (serialize.ts), the
// pattern picker's add-new-layer path, and the inspector's "Cover panel"
// reset (interaction follow-up sub). Do NOT duplicate it anywhere.

export interface PatternCoverGeometry {
  x: number;
  y: number;
  size: number;
}

export function patternCoverGeometry(panel: {
  widthMm: number;
  heightMm: number;
}): PatternCoverGeometry {
  const size = Math.max(panel.widthMm, panel.heightMm);
  return {
    x: (panel.widthMm - size) / 2,
    y: (panel.heightMm - size) / 2,
    size,
  };
}
