// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ShapeLayer } from '@zpd/core';
import type { ToolContext } from '../types';
import { LayerList } from './layer-list';

afterEach(cleanup);

const LAYER: ShapeLayer = {
  id: 's1',
  name: 'Rect',
  type: 'shape',
  shape: 'rect',
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  color: 1,
};

function stubCtx() {
  const commit = vi.fn();
  const select = vi.fn();
  const ctx = {
    doc: { panelHp: 12, layers: [LAYER] },
    commit,
    select,
  } as unknown as ToolContext;
  return { ctx, commit, select };
}

describe('LayerList rename', () => {
  it('double-click enters inline rename; Enter commits the new name via renameLayer', () => {
    const { ctx, commit } = stubCtx();
    render(<LayerList ctx={ctx} selectedId={null} />);

    fireEvent.doubleClick(screen.getByText('Rect'));
    const input = screen.getByDisplayValue('Rect');
    fireEvent.change(input, { target: { value: 'Header Cutout' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(commit).toHaveBeenCalledTimes(1);
    const [patchedDoc] = commit.mock.calls[0];
    expect(patchedDoc.layers[0]).toMatchObject({ id: 's1', name: 'Header Cutout' });
    // edit mode closed
    expect(screen.queryByDisplayValue('Header Cutout')).toBeNull();
  });

  it('Escape cancels without committing', () => {
    const { ctx, commit } = stubCtx();
    render(<LayerList ctx={ctx} selectedId={null} />);

    fireEvent.doubleClick(screen.getByText('Rect'));
    const input = screen.getByDisplayValue('Rect');
    fireEvent.change(input, { target: { value: 'discarded' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(commit).not.toHaveBeenCalled();
    expect(screen.getByText('Rect')).toBeTruthy();
  });

  it('blur without Enter cancels without committing', () => {
    const { ctx, commit } = stubCtx();
    render(<LayerList ctx={ctx} selectedId={null} />);

    fireEvent.doubleClick(screen.getByText('Rect'));
    const input = screen.getByDisplayValue('Rect');
    fireEvent.change(input, { target: { value: 'discarded' } });
    fireEvent.blur(input);

    expect(commit).not.toHaveBeenCalled();
    expect(screen.getByText('Rect')).toBeTruthy();
  });

  it('double-clicking the name does not also toggle selection', () => {
    const { ctx, select } = stubCtx();
    render(<LayerList ctx={ctx} selectedId={null} />);

    fireEvent.doubleClick(screen.getByText('Rect'));
    expect(select).not.toHaveBeenCalled();
  });
});
