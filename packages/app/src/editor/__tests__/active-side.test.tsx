// @vitest-environment jsdom
//
// Editor-level integration for the side-context foundation (#230):
//  - ctx.activeSide / ctx.activeStack read the live view state (front by
//    default, activeStack === the matching DocState stack by reference),
//  - an ACTUAL side switch clears the selection and discards the active
//    tool's draft via the onDeactivate/onActivate cycle,
//  - a same-side setActiveSide call is a strict no-op (no clears, no cycle).
// The Front/Back tab UI does not exist yet (#233) — a registered capture
// tool grabs the real ctx object, exactly the seam the future UI drives.
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import App from '../../App';
import { registerTool, unregisterTool } from '../registry/tools';
import type { ToolContext, ToolModule } from '../types';

const CAPTURE_TOOL_ID = 'test-side-capture';

interface Capture {
  ctx: ToolContext | null;
  activations: number;
  deactivations: number;
}

function registerCaptureTool(): Capture {
  const capture: Capture = { ctx: null, activations: 0, deactivations: 0 };
  const tool: ToolModule = {
    id: CAPTURE_TOOL_ID,
    label: 'SideCapture',
    onActivate(ctx) {
      capture.ctx = ctx;
      capture.activations += 1;
    },
    onDeactivate() {
      capture.deactivations += 1;
    },
  };
  registerTool(tool);
  return capture;
}

afterEach(() => {
  cleanup();
  unregisterTool(CAPTURE_TOOL_ID);
});

function mountWithCaptureTool(): Capture {
  const capture = registerCaptureTool();
  render(<App />);
  act(() => {
    screen.getByRole('button', { name: 'SideCapture' }).click();
  });
  expect(capture.ctx).not.toBeNull();
  return capture;
}

describe('ctx.activeSide / ctx.activeStack', () => {
  it('defaults to front, with activeStack reading the matching DocState stack by reference', () => {
    const capture = mountWithCaptureTool();
    const ctx = capture.ctx!;
    expect(ctx.activeSide).toBe('front');
    expect(ctx.activeStack).toBe(ctx.doc.layers);

    act(() => ctx.setActiveSide('back'));
    expect(ctx.activeSide).toBe('back');
    expect(ctx.activeStack).toBe(ctx.doc.backLayers);

    act(() => ctx.setActiveSide('front'));
    expect(ctx.activeSide).toBe('front');
    expect(ctx.activeStack).toBe(ctx.doc.layers);
  });
});

describe('ctx.setActiveSide lifecycle', () => {
  it('an actual switch clears the selection and cycles the active tool (draft discard)', () => {
    const capture = mountWithCaptureTool();
    const ctx = capture.ctx!;
    const leafId = ctx.flatLayers[0]!.id;
    act(() => ctx.selectIds([leafId]));
    expect(ctx.selectedIds).toEqual([leafId]);
    const activationsBefore = capture.activations;
    const deactivationsBefore = capture.deactivations;

    act(() => ctx.setActiveSide('back'));

    expect(ctx.selectedIds).toEqual([]);
    // The deactivate/activate pair is the same discard a tool switch runs.
    expect(capture.deactivations).toBe(deactivationsBefore + 1);
    expect(capture.activations).toBe(activationsBefore + 1);
  });

  it('a same-side call is a strict no-op: selection kept, no tool cycle', () => {
    const capture = mountWithCaptureTool();
    const ctx = capture.ctx!;
    const leafId = ctx.flatLayers[0]!.id;
    act(() => ctx.selectIds([leafId]));
    const activationsBefore = capture.activations;
    const deactivationsBefore = capture.deactivations;

    act(() => ctx.setActiveSide('front'));

    expect(ctx.selectedIds).toEqual([leafId]);
    expect(capture.deactivations).toBe(deactivationsBefore);
    expect(capture.activations).toBe(activationsBefore);
  });

  it('switch-then-switch-back within one handler lands on the original side (eager ref sync)', () => {
    const capture = mountWithCaptureTool();
    const ctx = capture.ctx!;
    act(() => {
      ctx.setActiveSide('back');
      // Without the eager ref write this second call would read a stale
      // 'front' from the passive-resync ref and wrongly no-op.
      ctx.setActiveSide('front');
    });
    expect(ctx.activeSide).toBe('front');
    expect(ctx.activeStack).toBe(ctx.doc.layers);
  });
});
