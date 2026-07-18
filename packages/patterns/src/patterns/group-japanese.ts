// Port shard: Japanese classics. Patterns ported from pgen land here in batch
// order; each port batch appends ONLY to its own shard so parallel branches
// never conflict (see .claude/skills/port-pgen-patterns/SKILL.md).

import type { PanelPatternGenerator } from '../types';
import { igeta } from './igeta';

export const groupJapanese: PanelPatternGenerator[] = [igeta];
