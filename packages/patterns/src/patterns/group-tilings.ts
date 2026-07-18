// Port shard: weaves, checks & tilings. Patterns ported from pgen land here in
// batch order; each port batch appends ONLY to its own shard so parallel
// branches never conflict (see .claude/skills/port-pgen-patterns/SKILL.md).

import type { PanelPatternGenerator } from '../types';
import { herringbone } from './herringbone';
import { houndstoothToothGrid } from './houndstooth-tooth-grid';
import { greekCrossLattice } from './greek-cross-lattice';
import { decoChevronGold } from './deco-chevron-gold';
import { valknutGrid } from './valknut-grid';
import { isometricCubeGrid } from './isometric-cube-grid';
import { ogee } from './ogee';
import { ammannBars } from './ammann-bars';
import { cairoPentagonal } from './cairo-pentagonal';
import { masuTsunagi } from './masu-tsunagi';

export const groupTilings: PanelPatternGenerator[] = [
  herringbone,
  houndstoothToothGrid,
  greekCrossLattice,
  decoChevronGold,
  valknutGrid,
  isometricCubeGrid,
  ogee,
  ammannBars,
  cairoPentagonal,
  masuTsunagi,
];
