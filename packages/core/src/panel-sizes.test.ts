import { describe, expect, it } from 'vitest';
import { createDefaultDoc } from './default-doc';
import {
  MAX_PANEL_HP,
  PANEL_HEIGHT_MM,
  PANEL_SIZES,
  PANEL_THICKNESS_MM,
  panelWidthMm,
} from './panel-sizes';
import { serializePanelConfig } from './serialize';

describe('MAX_PANEL_HP', () => {
  it('tracks the largest HP in the product size table', () => {
    expect(MAX_PANEL_HP).toBe(Math.max(...PANEL_SIZES.map((size) => size.hp)));
  });
});

describe('panelWidthMm', () => {
  it('returns the exact spec width for every tabulated HP', () => {
    for (const size of PANEL_SIZES) {
      expect(panelWidthMm(size.hp)).toBe(size.widthMm);
    }
  });

  it('falls back to the nominal 5.08mm pitch for HP not in the spec table', () => {
    expect(panelWidthMm(7)).toBeCloseTo(7 * 5.08, 5);
    expect(panelWidthMm(9)).toBeCloseTo(9 * 5.08, 5);
    expect(panelWidthMm(84)).toBeCloseTo(84 * 5.08, 5);
  });

  it('the fallback formula never coincides with a real tabulated width', () => {
    for (const size of PANEL_SIZES) {
      expect(size.hp * 5.08).not.toBe(size.widthMm);
    }
  });
});

describe('PANEL_HEIGHT_MM', () => {
  it('is the fixed 3U Eurorack height', () => {
    expect(PANEL_HEIGHT_MM).toBe(128.5);
  });
});

describe('PANEL_THICKNESS_MM', () => {
  it('is the exact manufactured PCB thickness', () => {
    expect(PANEL_THICKNESS_MM).toBe(2.5);
  });

  it('remains derived product data outside the persisted document schema', () => {
    const config = serializePanelConfig(createDefaultDoc());

    expect(Object.keys(config.panel).sort()).toEqual(['heightMm', 'hp', 'widthMm']);
    expect(JSON.stringify(config)).not.toContain('thicknessMm');
  });
});
