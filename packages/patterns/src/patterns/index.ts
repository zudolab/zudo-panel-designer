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
import { groupJapanese } from './group-japanese';
import { groupOrnament } from './group-ornament';
import { groupCurves } from './group-curves';
import { groupRingsCircuits } from './group-rings-circuits';
import { groupTilings } from './group-tilings';

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
  // pgen port shards spread AFTER the hand-written 12, in this fixed order —
  // batches append inside their own shard, so catalog order is independent of
  // branch merge order (see .claude/skills/port-pgen-patterns/SKILL.md).
  ...groupJapanese,
  ...groupOrnament,
  ...groupCurves,
  ...groupRingsCircuits,
  ...groupTilings,
];

export function patternByName(name: string): PanelPatternGenerator | undefined {
  return PATTERN_GENERATORS.find((g) => g.name === name);
}

export function defaultParams(name: string): Record<string, number> {
  const gen = patternByName(name);
  if (!gen) return {};
  return Object.fromEntries(gen.paramDefs.map((d) => [d.key, d.defaultValue]));
}
