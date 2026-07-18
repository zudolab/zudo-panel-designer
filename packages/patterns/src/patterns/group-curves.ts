// Port shard: curves, fractals & truchet. Patterns ported from pgen land here
// in batch order; each port batch appends ONLY to its own shard so parallel
// branches never conflict (see .claude/skills/port-pgen-patterns/SKILL.md).

import type { PanelPatternGenerator } from '../types';
import { smithTruchet } from './smith-truchet';

export const groupCurves: PanelPatternGenerator[] = [smithTruchet];
