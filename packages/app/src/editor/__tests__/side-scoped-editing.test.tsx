// @vitest-environment jsdom
//
// Editor-level integration for the #233 side-scoped editing migration:
//  - inserts land on the ACTIVE side's stack only (front content untouched
//    by a back insert and vice versa),
//  - hidden-side items are unselectable (selection normalizes against the
//    active stack) and invisible to ctx.flatLayers (the projection the
//    renderer, hit-testing, marquee and select-all all consume),
//  - undo/redo across side switches stays consistent — side is view state,
//    never history state,
//  - material gating: the Back tab renders only for fr4, switching the
//    material away from fr4 while Back is active jumps to Front, and the
//    back stack's CONTENTS survive the material switch untouched.
// Same capture-tool seam as active-side.test.tsx: a registered tool grabs
// the real ctx object the Editor hands every tool.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import App from '../../App';
import { registerTool, unregisterTool } from '../registry/tools';
import { allAddActions } from '../registry/add-actions';
import type { ToolContext, ToolModule } from '../types';

const CAPTURE_TOOL_ID = 'test-side-scope-capture';

function registerCaptureTool(): { ctx: ToolContext | null } {
  const capture: { ctx: ToolContext | null } = { ctx: null };
  const tool: ToolModule = {
    id: CAPTURE_TOOL_ID,
    label: 'SideScopeCapture',
    onActivate(ctx) {
      capture.ctx = ctx;
    },
  };
  registerTool(tool);
  return capture;
}

beforeEach(() => {
  // Autosave persists commits; without this a material/doc change made by
  // one test would boot-restore into the next.
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  unregisterTool(CAPTURE_TOOL_ID);
  localStorage.clear();
});

function mountWithCaptureTool(): ToolContext {
  const capture = registerCaptureTool();
  render(<App />);
  act(() => {
    screen.getByRole('button', { name: 'SideScopeCapture' }).click();
  });
  expect(capture.ctx).not.toBeNull();
  return capture.ctx!;
}

// The real registered toolbar action — the same production insert path a
// click takes (insertNewNodeRelativeToSelection over the active stack).
function runAddRect(ctx: ToolContext): void {
  const addRect = allAddActions().find((a) => a.id === 'add-rect');
  expect(addRect).toBeDefined();
  act(() => addRect!.run(ctx));
}

describe('side-scoped inserts (#233)', () => {
  it('an insert while Back is active lands on backLayers only, front untouched', () => {
    const ctx = mountWithCaptureTool();
    const frontBefore = ctx.doc.layers;
    act(() => ctx.setActiveSide('back'));

    runAddRect(ctx);

    // Front stack identity unchanged — the insert never touched it.
    expect(ctx.doc.layers).toBe(frontBefore);
    expect(ctx.flatLayers).toHaveLength(1);
    expect(ctx.doc.backLayers[0].children).toHaveLength(1);
    // The insert selected its own layer, on the back side.
    expect(ctx.selectedIds).toEqual([ctx.flatLayers[0]!.id]);
  });

  it('an insert while Front is active never reaches backLayers', () => {
    const ctx = mountWithCaptureTool();
    const backBefore = ctx.doc.backLayers;
    runAddRect(ctx);
    expect(ctx.doc.backLayers).toBe(backBefore);
  });
});

describe('hidden-side isolation (#233)', () => {
  it('hidden-side items are unselectable and absent from ctx.flatLayers', () => {
    const ctx = mountWithCaptureTool();
    const frontLeafId = ctx.flatLayers[0]!.id;
    act(() => ctx.setActiveSide('back'));

    // The front demo content is invisible to the flat view every consumer
    // (renderer, hit-test, marquee, select-all) reads…
    expect(ctx.flatLayers).toHaveLength(0);
    // …and an explicit attempt to select a front id normalizes to empty:
    // the id points into a stack the editor is not showing.
    act(() => ctx.selectIds([frontLeafId]));
    expect(ctx.selectedIds).toEqual([]);

    act(() => ctx.setActiveSide('front'));
    act(() => ctx.selectIds([frontLeafId]));
    expect(ctx.selectedIds).toEqual([frontLeafId]);
  });
});

describe('undo/redo across side switches (#233)', () => {
  it('side is view state: undo reverts the front edit while Back stays active', () => {
    const ctx = mountWithCaptureTool();
    const frontCountBefore = ctx.flatLayers.length;
    runAddRect(ctx); // commit on FRONT
    expect(ctx.flatLayers).toHaveLength(frontCountBefore + 1);

    act(() => ctx.setActiveSide('back'));
    act(() => ctx.undo());

    // The undo reverted the front commit; the view stayed on back.
    expect(ctx.activeSide).toBe('back');
    expect(ctx.doc.layers.flatMap((c) => c.children)).toHaveLength(
      // demo doc's front root children count == pre-insert state
      frontCountBefore,
    );

    act(() => ctx.redo());
    expect(ctx.activeSide).toBe('back');
    expect(ctx.doc.layers.flatMap((c) => c.children)).toHaveLength(frontCountBefore + 1);
  });
});

describe('material gating (#233)', () => {
  it('fr4 shows both face tabs; the Back tab drives setActiveSide', () => {
    const ctx = mountWithCaptureTool();
    expect(ctx.doc.material).toBe('fr4');
    const backTab = screen.getByRole('tab', { name: 'Back' });
    expect(screen.getByRole('tab', { name: 'Front' })).toBeTruthy();

    act(() => backTab.click());
    expect(ctx.activeSide).toBe('back');
    expect(screen.getByRole('tab', { name: 'Back' }).getAttribute('aria-selected')).toBe('true');
  });

  it('switching material away from fr4 while Back is active jumps to Front, hides the Back tab, and preserves back contents', () => {
    const ctx = mountWithCaptureTool();
    act(() => ctx.setActiveSide('back'));
    runAddRect(ctx); // author something on the back stack
    const backStackWithContent = ctx.doc.backLayers;
    expect(backStackWithContent[0].children).toHaveLength(1);

    act(() => ctx.commit({ ...ctx.doc, material: 'alumi' }));

    expect(ctx.activeSide).toBe('front');
    expect(screen.queryByRole('tab', { name: 'Back' })).toBeNull();
    // Never deleted — only hidden from the UI.
    expect(ctx.doc.backLayers).toBe(backStackWithContent);

    // Back to fr4: the tab returns and the back content is still there.
    act(() => ctx.commit({ ...ctx.doc, material: 'fr4' }));
    expect(screen.getByRole('tab', { name: 'Back' })).toBeTruthy();
    expect(ctx.doc.backLayers[0].children).toHaveLength(1);
  });
});
