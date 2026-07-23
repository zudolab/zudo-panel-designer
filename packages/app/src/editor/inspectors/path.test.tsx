// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createPcbLayerStack, type PathLayer } from '@zpd/core';
import type { ToolContext } from '../types';
import './path';
import { getInspector } from '../registry/inspectors';

afterEach(cleanup);

const layer: PathLayer = {
  id: 'path-1',
  name: 'Path',
  type: 'path',
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ],
  closed: false,
  fill: null,
  stroke: 2,
  strokeWidth: 0.6,
};

const Inspector = getInspector('path')!;

function ctx(): ToolContext {
  return {
    doc: {
      panelHp: 12,
      guides: [],
      layers: createPcbLayerStack({ copper: [layer] }),
    },
  } as unknown as ToolContext;
}

describe('path inspector material controls (#166)', () => {
  it('uses independent enabled controls and always enables with the owning material', () => {
    const onChange = vi.fn();
    render(<Inspector layer={layer} materialRole="copper" onChange={onChange} ctx={ctx()} />);

    expect(screen.getByText('Copper')).toBeTruthy();
    expect(screen.queryByTitle(/gold|black|white/i)).toBeNull();

    fireEvent.click(screen.getByLabelText('Fill enabled'));
    expect(onChange).toHaveBeenLastCalledWith({ fill: 1 });

    fireEvent.click(screen.getByLabelText('Stroke enabled'));
    expect(onChange).toHaveBeenLastCalledWith({ stroke: null });
  });

  it('preserves stroke width and closed controls independently of material', () => {
    const onChange = vi.fn();
    render(<Inspector layer={layer} materialRole="copper" onChange={onChange} ctx={ctx()} />);

    fireEvent.change(screen.getByLabelText('stroke w (mm)'), { target: { value: '1.2' } });
    fireEvent.blur(screen.getByLabelText('stroke w (mm)'));
    expect(onChange).toHaveBeenLastCalledWith({ strokeWidth: 1.2 });

    fireEvent.click(screen.getByLabelText('Closed'));
    expect(onChange).toHaveBeenLastCalledWith({ closed: true });
  });
});
