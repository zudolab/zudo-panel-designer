// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Guide, ShapeLayer } from '@zpd/core';
import type { ToolContext } from '../types';
import { projectFlatLayers } from '../flat-projection';
import { Sidebar } from './sidebar';

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

const GUIDES: Guide[] = [
  { id: 'guide-h1', orientation: 'horizontal', position: 12 },
  { id: 'guide-v1', orientation: 'vertical', position: 4, hidden: true },
];

function stubCtx() {
  const commit = vi.fn();
  const doc = { panelHp: 12, layers: [LAYER], guides: GUIDES };
  const ctx = {
    doc,
    selectedIds: [],
    commit,
    select: vi.fn(),
    selectIds: vi.fn(),
  } as unknown as ToolContext;
  Object.defineProperty(ctx, 'flatLayers', {
    get: () => projectFlatLayers(ctx.doc.layers),
  });
  return { ctx, doc, commit };
}

function renderSidebar(overrides: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  const { ctx, doc } = stubCtx();
  const onShowGuidesChange = vi.fn();
  render(
    <Sidebar
      ctx={ctx}
      doc={doc as Parameters<typeof Sidebar>[0]['doc']}
      selectedIds={[]}
      selectedLayer={null}
      activeToolId="select"
      showOutsidePanel
      onShowOutsidePanelChange={vi.fn()}
      showGuides
      onShowGuidesChange={onShowGuidesChange}
      {...overrides}
    />,
  );
  return { onShowGuidesChange };
}

describe('Sidebar — View section "Show guides"', () => {
  it('renders the Show guides checkbox reflecting the showGuides prop', () => {
    renderSidebar({ showGuides: true });
    const checkbox = screen.getByLabelText('Show guides') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('unchecks when showGuides is false', () => {
    renderSidebar({ showGuides: false });
    const checkbox = screen.getByLabelText('Show guides') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });

  it('toggling fires onShowGuidesChange with the new value', () => {
    const { onShowGuidesChange } = renderSidebar({ showGuides: true });
    fireEvent.click(screen.getByLabelText('Show guides'));
    expect(onShowGuidesChange).toHaveBeenCalledWith(false);
  });

  it('keeps a single "View" section (does not create a second one)', () => {
    renderSidebar();
    expect(screen.getAllByRole('button', { name: /^View/ })).toHaveLength(1);
  });
});

describe('Sidebar — guides are view furniture, not layers', () => {
  it('never lists guides in the Layers section', () => {
    renderSidebar();
    // The one shape layer shows; neither guide id/orientation leaks into the list.
    expect(screen.getByText('Rect')).toBeTruthy();
    expect(screen.queryByText(/guide-h1/)).toBeNull();
    expect(screen.queryByText(/guide-v1/)).toBeNull();
  });
});
