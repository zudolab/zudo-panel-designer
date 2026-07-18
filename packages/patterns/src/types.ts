// Pattern generator contract. A generator draws in OBJECT-LOCAL mm space: the
// caller pre-scales the 2D context so 1 unit = 1mm, pre-translates the origin
// to its draw region's top-left, and pre-clips to that region's rect
// (0,0)-(widthMm,heightMm). Since #96 a pattern layer's region is the layer's
// own square (the editor translates to the square's origin and clips to it —
// widthMm == heightMm == the square side); thumbnails pass their fixed 30mm
// window. There is deliberately NO larger-canvas / slice / viewport
// indirection here — generators compute only inside the given span, and the
// API is unchanged from the panel-bound days, so pattern ports are unaffected.
// Drawing is deterministic: identical inputs must reproduce identical pixels
// (no randomness anywhere), so an exported order JSON is faithfully replayable.

export interface PatternParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
}

export interface DrawOptions {
  // Draw-region dimensions in millimetres (a pattern layer's square, a
  // thumbnail's window). Draw only within (0,0)-(width,height).
  widthMm: number;
  heightMm: number;
  // A single palette hex (e.g. '#d4af37') the caller chose for this pattern.
  color: string;
  // Physical mm values keyed by PatternParamDef.key. Generators clamp each to
  // its def's [min,max] before use (see resolveParam in param-utils.ts).
  params: Record<string, number>;
}

export interface PanelPatternGenerator {
  name: string; // stable kebab id, e.g. 'dot-grid'
  displayName: string; // human-facing label
  paramDefs: PatternParamDef[];
  draw(ctx: CanvasRenderingContext2D, opts: DrawOptions): void;
}
