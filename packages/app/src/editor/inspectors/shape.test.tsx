// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createPcbLayerStack, type ShapeLayer } from '@zpd/core';
import type { ToolContext } from '../types';
import './shape';
import { getInspector } from '../registry/inspectors';

afterEach(cleanup);

const layer: ShapeLayer = {
  id: 'shape-1',
  name: 'Shape',
  type: 'shape',
  shape: 'rect',
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  color: 1,
};

const Inspector = getInspector('shape')!;

describe('shape inspector material context (#166)', () => {
  it('shows the owning Solder mask container and no object palette', () => {
    const onChange = vi.fn();
    const ctx = {
      doc: {
        panelHp: 12,
        guides: [],
        layers: createPcbLayerStack({ 'solder-mask': [layer] }),
      },
    } as unknown as ToolContext;

    render(<Inspector layer={layer} materialRole="solder-mask" onChange={onChange} ctx={ctx} />);

    expect(screen.getByText('Solder mask')).toBeTruthy();
    expect(screen.queryByText('Color')).toBeNull();
    expect(screen.queryByTitle(/black|gold|white/i)).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});
