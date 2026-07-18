// Port shard: Japanese classics. Patterns ported from pgen land here in batch
// order; each port batch appends ONLY to its own shard so parallel branches
// never conflict (see .claude/skills/port-pgen-patterns/SKILL.md).

import type { PanelPatternGenerator } from '../types';
import { igeta } from './igeta';
import { asanoha } from './asanoha';
import { kagome } from './kagome';
import { seigaiha } from './seigaiha';
import { shippo } from './shippo';
import { urokoScales } from './uroko-scales';
import { yagasuri } from './yagasuri';
import { sayagata } from './sayagata';
import { raimon } from './raimon';
import { wachigai } from './wachigai';
import { yoshiwaraTsunagi } from './yoshiwara-tsunagi';

export const groupJapanese: PanelPatternGenerator[] = [
  igeta,
  asanoha,
  kagome,
  seigaiha,
  shippo,
  urokoScales,
  yagasuri,
  sayagata,
  raimon,
  wachigai,
  yoshiwaraTsunagi,
];
