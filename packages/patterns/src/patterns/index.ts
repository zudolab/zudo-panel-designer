// Hand-listed registry — no codegen. 'dot-grid' MUST stay first / by that exact
// name (the core default document references it).

import type { PanelPatternGenerator } from '../types';
import { dotGrid } from './dot-grid';
import { diagStripes } from './diag-stripes';
import { gridLines } from './grid-lines';
import { concentricCircles } from './concentric-circles';
import { hexLattice } from './hex-lattice';
import { checker } from './checker';
import { waveLines } from './wave-lines';
import { crosshatch } from './crosshatch';
import { radialBurst } from './radial-burst';
import { brick } from './brick';
import { diamondLattice } from './diamond-lattice';
import { scallops } from './scallops';

export const PATTERN_GENERATORS: PanelPatternGenerator[] = [
  dotGrid,
  diagStripes,
  gridLines,
  concentricCircles,
  hexLattice,
  checker,
  waveLines,
  crosshatch,
  radialBurst,
  brick,
  diamondLattice,
  scallops,
];

export function patternByName(name: string): PanelPatternGenerator | undefined {
  return PATTERN_GENERATORS.find((g) => g.name === name);
}

export function defaultParams(name: string): Record<string, number> {
  const gen = patternByName(name);
  if (!gen) return {};
  return Object.fromEntries(gen.paramDefs.map((d) => [d.key, d.defaultValue]));
}
