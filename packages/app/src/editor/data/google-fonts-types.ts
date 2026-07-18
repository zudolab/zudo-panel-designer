export interface GoogleFontEntry {
  family: string;
  category: 'serif' | 'sans-serif' | 'display' | 'handwriting' | 'monospace';
  variants: string[];
  // Google's per-family language/script buckets (e.g. "latin", "japanese").
  // Used to derive the picker's Japanese filter via subsets.includes('japanese')
  // instead of maintaining a hand-picked family list.
  subsets: string[];
}

export type FontCategory = GoogleFontEntry['category'] | 'japanese';

export const FONT_CATEGORIES: FontCategory[] = [
  'sans-serif',
  'serif',
  'display',
  'handwriting',
  'monospace',
  'japanese',
];

export const CATEGORY_LABELS: Record<FontCategory, string> = {
  'sans-serif': 'Sans Serif',
  serif: 'Serif',
  display: 'Display',
  handwriting: 'Handwriting',
  monospace: 'Monospace',
  japanese: 'Japanese',
};
