// Port shard: circles, stars & circuit motifs. Patterns ported from pgen land
// here in batch order; each port batch appends ONLY to its own shard so
// parallel branches never conflict (see .claude/skills/port-pgen-patterns/SKILL.md).

import type { PanelPatternGenerator } from '../types';
import { vesicaLensCircleMesh } from './vesica-lens-circle-mesh';
import { ringsInterlock } from './rings-interlock';
import { circleQuarters } from './circle-quarters';
import { quatrefoil } from './quatrefoil';
import { hexCircuit } from './hex-circuit';
import { viaGridArray } from './via-grid-array';
import { circuitBoardTiles } from './circuit-board-tiles';
import { snowflakesGeometric } from './snowflakes-geometric';
import { eightPointCompassStarGrid } from './eight-point-compass-star-grid';

export const groupRingsCircuits: PanelPatternGenerator[] = [
  vesicaLensCircleMesh,
  ringsInterlock,
  circleQuarters,
  quatrefoil,
  hexCircuit,
  viaGridArray,
  circuitBoardTiles,
  snowflakesGeometric,
  eightPointCompassStarGrid,
];
