// Pattern generator contract. A generator draws directly in panel-mm space:
// the caller pre-scales the 2D context so 1 unit = 1mm and pre-clips it to the
// panel rect (0,0)-(widthMm,heightMm). There is deliberately NO larger-canvas /
// slice / viewport indirection here — patterns compute only inside the panel.
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
  // Blank panel dimensions in millimetres. Draw only within (0,0)-(width,height).
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
