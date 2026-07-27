// The #231 seam contract for #236: per-material back role lists with the
// pinned polarities, empty regions while the stub is in place, and no
// refusals reported from the stub.
import { createDefaultDoc } from '@zpd/core';
import { describe, expect, it } from 'vitest';
import type { BooleanEngine } from '../geometry-kernel';
import { extractBackLayers, type BackExtractContext } from './back-extract';
import type { GerberRefusalCode } from './ir';
import { DEFAULT_IR_LIMITS, DEFAULT_IR_TOLERANCE } from './tolerance';
import { FIXTURE_PANEL } from './test-ir';

function ctx(material: 'fr4' | 'alumi'): BackExtractContext {
  return {
    doc: { ...createDefaultDoc(), material },
    panel: FIXTURE_PANEL,
    // The stub never touches the engine; a real engine build would slow this
    // contract test down for nothing. #236's own tests construct a real one.
    engine: null as unknown as BooleanEngine,
    sources: [],
    tolerance: DEFAULT_IR_TOLERANCE,
    limits: DEFAULT_IR_LIMITS,
  };
}

describe('extractBackLayers (stub until #236)', () => {
  it('returns the FR-4 back trio with pinned polarities and empty regions', async () => {
    const layers = await extractBackLayers(ctx('fr4'), { add: () => {} });
    expect(layers.map((l) => [l.role, l.filePolarity, l.renderAs, l.regions])).toEqual([
      ['b-copper', 'positive', 'filled-region', []],
      ['b-solder-mask', 'negative', 'filled-region', []],
      ['b-silkscreen', 'positive', 'filled-region', []],
    ]);
  });

  it('returns only the B.Mask layer for alumi (Decision 12)', async () => {
    const layers = await extractBackLayers(ctx('alumi'), { add: () => {} });
    expect(layers.map((l) => l.role)).toEqual(['b-solder-mask']);
    expect(layers[0].filePolarity).toBe('negative');
  });

  it('reports nothing to the refusal sink', async () => {
    const seen: GerberRefusalCode[] = [];
    await extractBackLayers(ctx('fr4'), { add: (code) => seen.push(code) });
    expect(seen).toEqual([]);
  });
});
