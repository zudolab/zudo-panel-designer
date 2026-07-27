// The #231 seam contract for #235: the stub's observable behaviour — empty
// injections, an empty drill pair, header-only Excellon bytes modelled on the
// ordered reference sets — and the loud refusal that guards against a
// half-wired #235 silently shipping header-only files for real holes.
import { describe, expect, it } from 'vitest';
import { drillFilename, drillFileSet, emptyDrillIr, injectHoleFabrication } from './holes';
import { DEFAULT_IR_TOLERANCE } from './tolerance';
import { FIXTURE_OPTIONS, FIXTURE_PANEL } from './test-ir';

describe('injectHoleFabrication (stub until #235)', () => {
  it('returns no injections and an empty drill pair for both materials', () => {
    for (const material of ['fr4', 'alumi'] as const) {
      const fabrication = injectHoleFabrication({
        material,
        panel: FIXTURE_PANEL,
        tolerance: DEFAULT_IR_TOLERANCE,
      });
      expect(fabrication.injections).toEqual({});
      expect(fabrication.drill).toEqual(emptyDrillIr());
    }
  });
});

describe('drillFilename', () => {
  it("shares gerberFileSet's stem and the reference sets' -PTH/-NPTH suffix", () => {
    expect(drillFilename('pth', 12)).toBe('zpd-panel-12hp-PTH.drl');
    expect(drillFilename('npth', 12)).toBe('zpd-panel-12hp-NPTH.drl');
  });
});

describe('drillFileSet', () => {
  it('emits both files, PTH first, header-only while empty — byte-exact', () => {
    const [pth, npth] = drillFileSet(emptyDrillIr(), FIXTURE_PANEL, FIXTURE_OPTIONS);

    expect(pth.plating).toBe('pth');
    expect(pth.filename).toBe('zpd-panel-12hp-PTH.drl');
    expect(pth.text).toBe(
      [
        'M48',
        '; #@! TF.CreationDate,2026-07-25T09:30:00+09:00',
        '; #@! TF.GenerationSoftware,zudolab,zudo-panel-designer,0.0.0',
        '; #@! TF.FileFunction,Plated,1,2,PTH',
        'FMAT,2',
        'METRIC',
        '%',
        'G90',
        'G05',
        'M30',
        '',
      ].join('\n'),
    );

    expect(npth.plating).toBe('npth');
    expect(npth.filename).toBe('zpd-panel-12hp-NPTH.drl');
    expect(npth.text).toContain('; #@! TF.FileFunction,NonPlated,1,2,NPTH');
  });

  it('is LF-terminated ASCII, same discipline as the Gerber bodies', () => {
    for (const file of drillFileSet(emptyDrillIr(), FIXTURE_PANEL, FIXTURE_OPTIONS)) {
      expect(file.text).not.toContain('\r');
      expect(file.text.endsWith('M30\n')).toBe(true);
      // eslint-disable-next-line no-control-regex
      expect(file.text).toMatch(/^[\x09\x0a\x20-\x7e]*$/);
    }
  });

  it('refuses loudly on drill content until #235 implements body emission', () => {
    const drill = {
      ...emptyDrillIr(),
      npth: {
        plating: 'npth' as const,
        tools: [{ code: 1, diameterMm: 3.2 }],
        hits: [{ tool: 1, x: 5, y: 3 }],
        slots: [],
      },
    };
    expect(() => drillFileSet(drill, FIXTURE_PANEL, FIXTURE_OPTIONS)).toThrow(/#235/);
  });
});
