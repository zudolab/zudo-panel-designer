// Selection → ordered inputs, and where the result lands.
//
// The back→front ordering assertions here are the ONLY thing standing between a
// reordered flat projection and Minus Front / Minus Back / Trim / Crop silently
// operating on the wrong operand — those ops read z-role purely off the array
// index and throw nothing when it is wrong. That is why the order is compared
// against `projectFlatLayers` itself rather than a hand-written expectation.
import {
  createPcbLayerStack,
  type GroupNode,
  type ImageLayer,
  type Layer,
  type LayerNode,
  type PathLayer,
  type PatternLayer,
  type PcbLayerStack,
  type ShapeLayer,
  type TextLayer,
} from '@zpd/core';
import { describe, expect, it } from 'vitest';
import { projectFlatLayers } from '../flat-projection';
import { expandSelectionToLeafIds } from '../selection-resolve';
import { pathfinderTarget, resolvePathfinderInputs } from './selection';
import { rectPoints } from './test-fixtures';

const path = (id: string, x: number, hidden?: boolean): PathLayer => ({
  id,
  name: id,
  type: 'path',
  points: rectPoints(x, 0, 10, 10),
  closed: true,
  fill: 2, // deliberately NOT the copper colour — the projection re-normalizes it
  stroke: null,
  strokeWidth: 0,
  ...(hidden ? { hidden: true } : {}),
});

const shape = (id: string, x: number, hidden?: boolean): ShapeLayer => ({
  id,
  name: id,
  type: 'shape',
  shape: 'rect',
  x,
  y: 0,
  width: 10,
  height: 10,
  color: 0,
  ...(hidden ? { hidden: true } : {}),
});

const text = (id: string): TextLayer => ({
  id,
  name: id,
  type: 'text',
  content: 'x',
  fontFamily: 'Inter',
  sizeMm: 4,
  x: 0,
  y: 0,
  color: 2,
});

const image = (id: string): ImageLayer => ({
  id,
  name: id,
  type: 'image',
  src: 'data:image/png;base64,',
  x: 0,
  y: 0,
  width: 10,
  height: 10,
});

const pattern = (id: string): PatternLayer => ({
  id,
  name: id,
  type: 'pattern',
  patternType: 'stripes',
  params: {},
  color: 1,
  x: 0,
  y: 0,
  size: 10,
});

const group = (id: string, children: LayerNode[], hidden?: boolean): GroupNode => ({
  kind: 'group',
  id,
  name: id,
  children,
  ...(hidden ? { hidden: true } : {}),
});

const isEligible = (layer: Layer) => layer.type === 'path' || layer.type === 'shape';

/**
 * The order the flat projection itself yields, filtered the same way. Group
 * expansion is shared with the implementation on purpose — the claim under test
 * is that the ORDER comes from `projectFlatLayers`, not that the expansion does.
 */
function expectedOrder(stack: PcbLayerStack, selectedIds: string[]): string[] {
  const covered = new Set(expandSelectionToLeafIds(stack, selectedIds));
  return projectFlatLayers(stack)
    .filter((layer) => covered.has(layer.id) && !layer.hidden && isEligible(layer))
    .map((layer) => layer.id);
}

describe('resolvePathfinderInputs — back→front ordering contract', () => {
  const stack = createPcbLayerStack({
    copper: [path('A', 0), group('G', [shape('B', 20), path('C', 40)])],
    'solder-mask': [path('D', 60)],
    silkscreen: [shape('E', 80), text('F')],
  });
  const allIds = ['A', 'G', 'D', 'E', 'F'];

  it('yields physical bottom→top: copper, then solder-mask, then silkscreen', () => {
    const inputs = resolvePathfinderInputs(stack, allIds);
    expect(inputs.map((i) => i.id)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(inputs.map((i) => i.role)).toEqual([
      'copper',
      'copper',
      'copper',
      'solder-mask',
      'silkscreen',
    ]);
    // index 0 is the BACKMOST, last is the FRONTMOST.
    expect(inputs[0]!.id).toBe('A');
    expect(inputs[inputs.length - 1]!.id).toBe('E');
  });

  it('matches projectFlatLayers exactly — the same order the renderer paints', () => {
    const inputs = resolvePathfinderInputs(stack, allIds);
    expect(inputs.map((i) => i.id)).toEqual(expectedOrder(stack, allIds));
  });

  it('is insensitive to the order the ids were selected in', () => {
    const reversed = resolvePathfinderInputs(stack, ['E', 'D', 'G', 'A']);
    expect(reversed.map((i) => i.id)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('expands a group id to its descendant leaves in tree order', () => {
    expect(resolvePathfinderInputs(stack, ['G']).map((i) => i.id)).toEqual(['B', 'C']);
  });

  it('keeps inputs from different groups at different depths (no same-parent rule)', () => {
    const nested = createPcbLayerStack({
      copper: [group('G1', [group('G2', [path('deep', 0)])]), path('shallow', 20)],
    });
    expect(resolvePathfinderInputs(nested, ['G1', 'shallow']).map((i) => i.id)).toEqual([
      'deep',
      'shallow',
    ]);
  });

  it('carries the PROJECTED leaf, so material normalization is already applied', () => {
    // `path()` authors fill 2 (white); living in copper, the projection makes it 1.
    const copperPath = resolvePathfinderInputs(stack, ['A'])[0]!;
    expect(copperPath.layer.type).toBe('path');
    expect((copperPath.layer as PathLayer).fill).toBe(1);
  });
});

describe('resolvePathfinderInputs — eligibility', () => {
  it('admits only path and shape leaves', () => {
    const stack = createPcbLayerStack({
      copper: [path('p', 0), shape('s', 20), pattern('pat'), image('img')],
      silkscreen: [text('t')],
    });
    expect(resolvePathfinderInputs(stack, ['p', 's', 'pat', 'img', 't']).map((i) => i.id)).toEqual([
      'p',
      's',
    ]);
  });

  it('drops a hidden leaf, a leaf under a hidden group, and a hidden container', () => {
    const stack = createPcbLayerStack({
      copper: [
        path('visible', 0),
        path('hidden-leaf', 20, true),
        group('GH', [path('under', 40)], true),
      ],
      silkscreen: [shape('silk', 60)],
    });
    stack[2] = { ...stack[2], hidden: true };
    expect(
      resolvePathfinderInputs(stack, ['visible', 'hidden-leaf', 'GH', 'silk']).map((i) => i.id),
    ).toEqual(['visible']);
  });

  it('is empty for an empty selection or ids that resolve to nothing', () => {
    const stack = createPcbLayerStack({ copper: [path('p', 0)] });
    expect(resolvePathfinderInputs(stack, [])).toEqual([]);
    expect(resolvePathfinderInputs(stack, ['ghost'])).toEqual([]);
  });
});

describe('pathfinderTarget — cross-material destination', () => {
  const stack = createPcbLayerStack({
    copper: [path('cu', 0)],
    'solder-mask': [path('mask', 20)],
    silkscreen: [shape('silk', 40)],
  });

  it('is the container of the FRONTMOST input, not the backmost or the majority', () => {
    const inputs = resolvePathfinderInputs(stack, ['cu', 'mask', 'silk']);
    expect(pathfinderTarget(inputs)).toEqual({ role: 'silkscreen', frontmostLeafId: 'silk' });
  });

  it('follows the frontmost when the topmost material is deselected', () => {
    const inputs = resolvePathfinderInputs(stack, ['cu', 'mask']);
    expect(pathfinderTarget(inputs)).toEqual({ role: 'solder-mask', frontmostLeafId: 'mask' });
  });

  it('is the single input for a one-leaf selection', () => {
    expect(pathfinderTarget(resolvePathfinderInputs(stack, ['cu']))).toEqual({
      role: 'copper',
      frontmostLeafId: 'cu',
    });
  });

  it('is null with no inputs', () => {
    expect(pathfinderTarget([])).toBeNull();
  });
});
