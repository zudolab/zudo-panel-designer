// @vitest-environment jsdom
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import * as Icons from './icons';

afterEach(cleanup);

const REQUIRED_ICON_NAMES = [
  'Select',
  'Pan',
  'Zoom',
  'Pen',
  'Text',
  'Rect',
  'Ellipse',
  'Pattern',
  'Image',
  'Undo',
  'Redo',
  'Upload',
  'Download',
  'Eye',
  'EyeOff',
  'Trash',
  'Close',
  'ChevronUp',
  'ChevronDown',
  'ChevronRight',
  'Folder',
  'Ungroup',
  'Path',
  'Star',
  'StarOutline',
  'ClosePath',
  'Layer',
] as const;

const iconComponents = Object.entries(Icons).filter(([, value]) => typeof value === 'function') as [
  string,
  (props: { className?: string }) => ReactElement,
][];

describe('icons', () => {
  it('exports every icon required by the Wave-3 consumer sub-issues', () => {
    for (const name of REQUIRED_ICON_NAMES) {
      expect(Icons).toHaveProperty(name);
    }
  });

  it.each(iconComponents)(
    'renders %s as a self-contained svg matching the pgen contract',
    (_name, Icon) => {
      const { container } = render(<Icon className="h-4 w-4" />);
      const svg = container.querySelector('svg');

      expect(svg).toBeTruthy();
      expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
      expect(svg?.classList.contains('h-4')).toBe(true);
      expect(svg?.classList.contains('w-4')).toBe(true);

      const fill = svg?.getAttribute('fill');
      const stroke = svg?.getAttribute('stroke');
      // Every glyph is currentColor-only: either a stroked outline or an
      // intentionally-solid fill, never a hardcoded color.
      expect(fill === 'currentColor' || stroke === 'currentColor').toBe(true);
    },
  );

  it('renders without a className when none is passed', () => {
    const { container } = render(<Icons.Select />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute('class')).toBeFalsy();
  });
});
