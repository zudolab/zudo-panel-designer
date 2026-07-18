// @vitest-environment jsdom
//
// minCount's selection-reference thresholds are the SAME constants core's
// align.ts uses (finding #8) — this locks them together so the app side can't
// silently re-hardcode 2/3 and drift from core's alignLayers/distributeLayers.
import { describe, expect, it } from 'vitest';
import { MIN_ALIGN_SELECTION, MIN_DISTRIBUTE_SELECTION } from '@zpd/core';
import { minCount } from './align-ops';

describe('minCount thresholds come from core', () => {
  it('selection reference uses core MIN_ALIGN_SELECTION / MIN_DISTRIBUTE_SELECTION', () => {
    expect(minCount('align', 'selection')).toBe(MIN_ALIGN_SELECTION);
    expect(minCount('distribute', 'selection')).toBe(MIN_DISTRIBUTE_SELECTION);
  });

  it('the shared values are unchanged (align 2+, distribute 3+)', () => {
    expect(MIN_ALIGN_SELECTION).toBe(2);
    expect(MIN_DISTRIBUTE_SELECTION).toBe(3);
  });

  it('panel reference still works from a single layer', () => {
    expect(minCount('align', 'panel')).toBe(1);
    expect(minCount('distribute', 'panel')).toBe(1);
  });
});
