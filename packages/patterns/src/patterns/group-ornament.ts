// Port shard: Islamic, Indian & heritage ornament. Patterns ported from pgen
// land here in batch order; each port batch appends ONLY to its own shard so
// parallel branches never conflict (see .claude/skills/port-pgen-patterns/SKILL.md).

import type { PanelPatternGenerator } from '../types';
import { rubElHizb } from './rub-el-hizb';
import { starAndCrossField } from './star-and-cross-field';
import { interlacedBands } from './interlaced-bands';
import { mughalJali } from './mughal-jali';
import { tenPointRosette } from './ten-point-rosette';
import { kolamSikku } from './kolam-sikku';
import { aztecStepFret } from './aztec-step-fret';
import { meander } from './meander';
import { endlessKnot } from './endless-knot';
import { bishamonKoushi } from './bishamon-koushi';

export const groupOrnament: PanelPatternGenerator[] = [
  rubElHizb,
  starAndCrossField,
  interlacedBands,
  mughalJali,
  tenPointRosette,
  kolamSikku,
  aztecStepFret,
  meander,
  endlessKnot,
  bishamonKoushi,
];
