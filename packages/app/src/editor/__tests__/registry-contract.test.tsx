// @vitest-environment jsdom
//
// Proves the Wave-5 extension contract end to end:
//  1. built-in tools/inspectors/add-actions auto-register via import.meta.glob
//     (drop-a-file discovery), and
//  2. a THROWAWAY tool + inspector + dialog registered through the PUBLIC
//     register*() API are discoverable and actually drive the UI.
// jsdom has no real 2D canvas; we test registration/wiring, not pixels.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from '../../App';
import {
  allAddActions,
  allTools,
  getDialog,
  getInspector,
  getTool,
  openDialog,
  registerDialog,
  registerInspector,
  registerTool,
  unregisterDialog,
  unregisterTool,
} from '../registry';
import { DialogHost } from '../components/dialog-host';
import { InspectorHost } from '../components/inspector-host';
import type { Pt, ShapeLayer } from '@zpd/core';
import type { DraftRenderContext } from '../types';
import type { CommandContext } from '../commands';

const BUILT_IN_DIALOG_IDS = [
  'command-palette',
  'confirm-dialog',
  'font-explorer',
  'pattern-picker',
  'shortcut-panel',
  'trace',
] as const;

afterEach(cleanup);

// Minimal context stand-in for exercising handlers/hosts in isolation.
// Typed CommandContext because DialogHost's ctx prop needs it; tool handlers
// and InspectorHost read only the ToolContext subset.
function stubCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  const base = {
    doc: { panelHp: 12, layers: [] },
    camera: { pxPerMm: 1, offsetX: 0, offsetY: 0 },
    panel: { widthMm: 60, heightMm: 128.5 },
    selectedIds: [],
    selectedId: null,
    selectedLayer: null,
    toMm: (p: Pt) => p,
    toScreen: (p: Pt) => p,
    commit: vi.fn(),
    replace: vi.fn(),
    beginGesture: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    select: vi.fn(),
    selectIds: vi.fn(),
    setCamera: vi.fn(),
    setActiveTool: vi.fn(),
    requestRepaint: vi.fn(),
    openDialog: vi.fn(),
    closeDialog: vi.fn(),
  } as unknown as CommandContext;
  return Object.assign(base, overrides);
}

describe('auto-discovery (import.meta.glob)', () => {
  it('registers the built-in select/pan/zoom tools with zero manual wiring', () => {
    expect(getTool('select')).toBeDefined();
    expect(getTool('pan')).toBeDefined();
    expect(getTool('zoom')).toBeDefined();
    // and they carry their metadata
    expect(getTool('zoom')?.shortcut).toBe('z');
  });

  it('registers the built-in inspectors and add-actions', () => {
    expect(getInspector('shape')).toBeDefined();
    expect(getInspector('pattern')).toBeDefined();
    const ids = allAddActions().map((a) => a.id);
    expect(ids).toEqual(
      expect.arrayContaining(['add-rect', 'add-ellipse', 'add-pattern', 'add-image']),
    );
  });

  it('gives every built-in dialog a non-empty accessible-name reference', () => {
    for (const id of BUILT_IN_DIALOG_IDS) {
      const dialog = getDialog(id);
      expect(dialog, `${id} should be registered`).toBeDefined();
      expect(dialog?.labelledBy?.trim(), `${id} should define labelledBy`).not.toBe('');
    }
  });
});

describe('public registry API — throwaway tool', () => {
  it('registerTool makes a new tool discoverable and routable', () => {
    const onPointerDown = vi.fn();
    const renderDraft = vi.fn();
    registerTool({
      id: 'demo-throwaway',
      label: 'Demo',
      shortcut: '9',
      onPointerDown,
      renderDraft,
    });
    try {
      expect(getTool('demo-throwaway')).toBeDefined();
      expect(allTools().some((t) => t.id === 'demo-throwaway')).toBe(true);

      const ctx = stubCtx();
      const e = {
        screen: { x: 5, y: 6 },
        mm: { x: 1, y: 2 },
        button: 0,
        buttons: 1,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
        pointerId: 1,
        preventDefault: vi.fn(),
      };
      getTool('demo-throwaway')?.onPointerDown?.(e, ctx);
      expect(onPointerDown).toHaveBeenCalledWith(e, ctx);

      // the renderDraft hook is invokable with a draft context
      const draft = { inMmSpace: (fn: () => void) => fn() } as unknown as DraftRenderContext;
      getTool('demo-throwaway')?.renderDraft?.(draft, ctx);
      expect(renderDraft).toHaveBeenCalled();
    } finally {
      unregisterTool('demo-throwaway');
    }
    expect(getTool('demo-throwaway')).toBeUndefined();
  });
});

describe('public registry API — throwaway inspector', () => {
  it('registerInspector drives the InspectorHost for that layer type', () => {
    const original = getInspector('shape');
    registerInspector('shape', () => <div>DEMO-INSPECTOR</div>);
    try {
      const layer: ShapeLayer = {
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
      const ctx = stubCtx();
      render(<InspectorHost ctx={ctx} doc={ctx.doc} layer={layer} selectedIds={[layer.id]} />);
      expect(screen.getByText('DEMO-INSPECTOR')).toBeTruthy();
    } finally {
      // restore the real inspector so we don't leak into other assertions
      if (original) registerInspector('shape', original);
    }
  });
});

describe('public registry API — throwaway dialog', () => {
  it('registerDialog + openDialog render through the DialogHost, close removes it', () => {
    registerDialog({
      id: 'demo-dialog',
      component: ({ close }) => (
        <div>
          DEMO-DIALOG
          <button onClick={close}>x</button>
        </div>
      ),
    });
    try {
      const { queryByText, getByText } = render(<DialogHost ctx={stubCtx()} />);
      expect(queryByText('DEMO-DIALOG')).toBeNull();

      // openDialog is an external-store update, so flush it inside act()
      act(() => openDialog('demo-dialog'));
      expect(getByText('DEMO-DIALOG')).toBeTruthy();

      fireEvent.click(getByText('x'));
      expect(queryByText('DEMO-DIALOG')).toBeNull();
    } finally {
      unregisterDialog('demo-dialog');
    }
  });
});

describe('shell smoke', () => {
  it('mounts the whole editor with no console errors', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<App />);
    // the toolbar renders the discovered tools
    expect(screen.getAllByLabelText(/Select/i).length).toBeGreaterThan(0);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
