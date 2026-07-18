// Port shard: curves, fractals & truchet. Patterns ported from pgen land here
// in batch order; each port batch appends ONLY to its own shard so parallel
// branches never conflict (see .claude/skills/port-pgen-patterns/SKILL.md).

import type { PanelPatternGenerator } from '../types';
import { smithTruchet } from './smith-truchet';
import { hilbertCurve } from './hilbert-curve';
import { dragonCurve } from './dragon-curve';
import { vicsekFractal } from './vicsek-fractal';
import { astroidGrid } from './astroid-grid';
import { maurerRose } from './maurer-rose';
import { guilloche } from './guilloche';
import { truchetQuarterArc } from './truchet-quarter-arc';
import { labyrinthClassical } from './labyrinth-classical';
import { steinerChain } from './steiner-chain';

export const groupCurves: PanelPatternGenerator[] = [
  smithTruchet,
  hilbertCurve,
  dragonCurve,
  vicsekFractal,
  astroidGrid,
  maurerRose,
  guilloche,
  truchetQuarterArc,
  labyrinthClassical,
  steinerChain,
];
