import { describe, expect, it } from 'vitest';
import catalogData from './google-fonts-catalog.json';
import { CATEGORY_LABELS, FONT_CATEGORIES, type GoogleFontEntry } from './google-fonts-types';

const catalog = catalogData as GoogleFontEntry[];

const CATEGORIES = new Set(['sans-serif', 'serif', 'display', 'handwriting', 'monospace']);

describe('google-fonts-catalog.json', () => {
  it('has more than 1500 families', () => {
    expect(catalog.length).toBeGreaterThan(1500);
  });

  it('is sorted alphabetically by family', () => {
    const families = catalog.map((entry) => entry.family);
    const sorted = [...families].sort((a, b) => a.localeCompare(b));
    expect(families).toEqual(sorted);
  });

  it('every entry has the {family, category, variants, subsets} shape', () => {
    for (const entry of catalog) {
      expect(typeof entry.family).toBe('string');
      expect(entry.family.length).toBeGreaterThan(0);
      expect(CATEGORIES.has(entry.category)).toBe(true);
      expect(Array.isArray(entry.variants)).toBe(true);
      expect(entry.variants.length).toBeGreaterThan(0);
      expect(Array.isArray(entry.subsets)).toBe(true);
    }
  });

  it('a known Japanese family is filterable via subsets.includes("japanese")', () => {
    const notoSansJp = catalog.find((entry) => entry.family === 'Noto Sans JP');
    expect(notoSansJp).toBeDefined();
    expect(notoSansJp?.subsets.includes('japanese')).toBe(true);

    const japaneseFamilies = catalog.filter((entry) => entry.subsets.includes('japanese'));
    expect(japaneseFamilies.length).toBeGreaterThan(0);
  });

  it('does not carry Google\'s internal "menu" preview bucket as a subset', () => {
    expect(catalog.every((entry) => !entry.subsets.includes('menu'))).toBe(true);
  });
});

describe('google-fonts-types', () => {
  it('FONT_CATEGORIES includes the 5 catalog categories plus the synthetic "japanese" filter', () => {
    expect(FONT_CATEGORIES).toEqual([
      'sans-serif',
      'serif',
      'display',
      'handwriting',
      'monospace',
      'japanese',
    ]);
  });

  it('CATEGORY_LABELS has a label for every category', () => {
    for (const category of FONT_CATEGORIES) {
      expect(CATEGORY_LABELS[category]).toBeTruthy();
    }
  });
});
