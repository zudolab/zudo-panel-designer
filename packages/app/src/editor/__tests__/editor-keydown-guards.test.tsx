// @vitest-environment jsdom
//
// Editor-level integration for two guards on the app's global window keydown
// chain (tracking issue #83):
//  - finding 1: while ANY dialog is open, the whole app-level fallback chain
//    (Space-hold pan arming, tool shortcuts, clipboard/undo/redo dispatch,
//    Delete/nudge, Escape-deselect) must NOT run — the modal owns the keyboard.
//  - finding 4: the chain uses the SHARED isEditableTarget (with the
//    isContentEditable check), so Space inside a contentEditable never arms pan.
//
// The chain is gated as a single early-return, so proving Space (the pan-arm
// branch) and a dispatchCommand-routed key (tool switch / undo) are both
// suppressed proves Delete/clipboard/etc. are too — they share that one gate.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from '../../App';
import * as commandsModule from '../commands';
import { closeDialog, getOpenDialog } from '../registry/dialogs';

afterEach(() => {
  cleanup();
  closeDialog();
  vi.restoreAllMocks();
});

function dispatchKeydown(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(e);
  });
  return e;
}

function toolButton(name: string): HTMLElement {
  return screen.getByRole('button', { name });
}

describe('global keydown — open-dialog guard (finding 1)', () => {
  it('while a dialog is open, Space is not preventDefaulted and the command chain does not fire', () => {
    render(<App />);
    // Switch to Pen first, so a later 'v' (Select) would visibly flip the
    // active tool if the guard failed.
    fireEvent.keyDown(window, { key: 'p' });
    expect(toolButton('Pen (P)').className).toContain('border-sky-500');

    fireEvent.keyDown(window, { key: '?' }); // open the shortcuts dialog
    expect(getOpenDialog()).not.toBeNull();

    // Space would arm pan + preventDefault without the guard.
    const space = dispatchKeydown(window, { code: 'Space', key: ' ' });
    expect(space.defaultPrevented).toBe(false);

    // 'v' (Select shortcut, a dispatchCommand tool-switch) must not switch tools.
    dispatchKeydown(window, { key: 'v' });
    expect(toolButton('Pen (P)').className).toContain('border-sky-500');
    expect(toolButton('Select (V)').className).not.toContain('border-sky-500');

    // Cmd+Z (a preventDefault-flagged command) must not be preventDefaulted.
    const undo = dispatchKeydown(window, { key: 'z', metaKey: true });
    expect(undo.defaultPrevented).toBe(false);
  });

  it('with no dialog open, the pre-existing chain still runs (Space and Cmd+Z are preventDefaulted)', () => {
    render(<App />);
    expect(getOpenDialog()).toBeNull();

    expect(dispatchKeydown(window, { code: 'Space', key: ' ' }).defaultPrevented).toBe(true);
    expect(dispatchKeydown(window, { key: 'z', metaKey: true }).defaultPrevented).toBe(true);
  });
});

describe('global keydown — contentEditable guard (finding 4)', () => {
  it('Space typed into a contentEditable does not arm pan / preventDefault', () => {
    render(<App />);
    const editable = document.createElement('div');
    // jsdom does not compute isContentEditable from the attribute, so pin it.
    Object.defineProperty(editable, 'isContentEditable', { value: true, configurable: true });
    document.body.appendChild(editable);
    try {
      expect(dispatchKeydown(editable, { code: 'Space', key: ' ' }).defaultPrevented).toBe(false);
    } finally {
      editable.remove();
    }
  });

  it('Space on a non-editable element still arms pan — the guard is specific to editable targets', () => {
    render(<App />);
    const plain = document.createElement('div');
    document.body.appendChild(plain);
    try {
      expect(dispatchKeydown(plain, { code: 'Space', key: ' ' }).defaultPrevented).toBe(true);
    } finally {
      plain.remove();
    }
  });
});

// #155: Group/Ungroup are registered CommandDefs dispatched through the SAME
// keydown chain/isEditableTarget gate as every other command — proven
// generically above (Cmd+Z), but the issue calls out an explicit routing
// test for the new ⌘G/⌘⇧G chords specifically. isEnabled gating (which
// depends on selection state, unlike Cmd+Z's ALWAYS_ENABLED) is already
// covered in commands.test.ts; what's proven here is that dispatchCommand
// itself is never even reached from a real INPUT — independent of whether
// the command would have been enabled.
describe('⌘G / ⌘⇧G routing — the isEditableTarget guard applies to Group/Ungroup too', () => {
  it('⌘G reaches dispatchCommand from the window, but not from a real input element', () => {
    const spy = vi.spyOn(commandsModule, 'dispatchCommand');
    const { container } = render(<App />);

    fireEvent.keyDown(window, { key: 'g', metaKey: true });
    expect(spy).toHaveBeenCalledTimes(1);

    const fileInput = container.querySelector('input[type="file"]');
    expect(fileInput).toBeTruthy();
    fireEvent.keyDown(fileInput!, { key: 'g', metaKey: true });
    // Unchanged — isEditableTarget short-circuited before dispatchCommand.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('⌘⇧G reaches dispatchCommand from the window, but not from a real input element', () => {
    const spy = vi.spyOn(commandsModule, 'dispatchCommand');
    const { container } = render(<App />);

    fireEvent.keyDown(window, { key: 'g', metaKey: true, shiftKey: true });
    expect(spy).toHaveBeenCalledTimes(1);

    const fileInput = container.querySelector('input[type="file"]');
    fireEvent.keyDown(fileInput!, { key: 'g', metaKey: true, shiftKey: true });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
