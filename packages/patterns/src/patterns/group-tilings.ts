// Port shard: weaves, checks & tilings. Patterns ported from pgen land here in
// batch order; each port batch appends ONLY to its own shard so parallel
// branches never conflict (see .claude/skills/port-pgen-patterns/SKILL.md).

import type { PanelPatternGenerator } from '../types';

export const groupTilings: PanelPatternGenerator[] = [];
