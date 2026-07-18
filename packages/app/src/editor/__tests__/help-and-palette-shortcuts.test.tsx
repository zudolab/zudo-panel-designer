// @vitest-environment jsdom
//
// Editor-level integration test for issue #77's two entry points: the `?`
// key (guarded by isEditableTarget) and Cmd/Ctrl+Shift+K for the command
// palette. commands.test.ts already covers the CommandDef dispatch/chord
// logic in isolation; this proves the FULL path — Editor.tsx's window
// keydown listener → isEditableTarget guard → dispatchCommand → ctx.openDialog
// → DialogHost actually rendering the right dialog — the same style of
// full-mount check as __tests__/registry-contract.test.tsx's "shell smoke".
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from '../../App';
import { closeDialog } from '../registry/dialogs';

// The dialog store (registry/dialogs.ts) is a module-level singleton, not
// React state — cleanup() only unmounts, it never resets it. Without this,
// a dialog left open by one test leaks straight into the next test's fresh
// <App/> mount (same failure mode header.test.tsx / dialog-host.test.tsx
// already guard against).
afterEach(() => {
  cleanup();
  closeDialog();
});

describe('"?" opens the shortcuts overlay, but not while editing text', () => {
  it('"?" on the window opens the shortcut-panel dialog', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: '?' });
    expect(screen.getByText('Keyboard shortcuts')).toBeTruthy();
  });

  it('"?" typed into a real input/textarea/select does NOT open the overlay', () => {
    const { container } = render(<App />);
    // Header's hidden JSON-import <input type="file"> is a real INPUT element
    // already in the tree — isEditableTarget() matches by tagName alone,
    // so it's a valid stand-in for "the user is editing text somewhere".
    const fileInput = container.querySelector('input[type="file"]');
    expect(fileInput).toBeTruthy();

    fireEvent.keyDown(fileInput!, { key: '?' });
    expect(screen.queryByText('Keyboard shortcuts')).toBeNull();
  });
});

describe('Cmd/Ctrl+Shift+K opens the command palette, but not while editing text', () => {
  it('Ctrl+Shift+K on the window opens the command-palette dialog', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true, shiftKey: true });
    expect(screen.getByPlaceholderText('Type a command…')).toBeTruthy();
  });

  it('Cmd+Shift+K on a real input does NOT open the palette', () => {
    const { container } = render(<App />);
    const fileInput = container.querySelector('input[type="file"]');
    expect(fileInput).toBeTruthy();

    fireEvent.keyDown(fileInput!, { key: 'k', metaKey: true, shiftKey: true });
    expect(screen.queryByPlaceholderText('Type a command…')).toBeNull();
  });

  it('running a command from the palette actually executes it against the live editor', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true, shiftKey: true });

    fireEvent.change(screen.getByPlaceholderText('Type a command…'), {
      target: { value: 'keyboard shortcuts' },
    });
    fireEvent.click(screen.getByText('Keyboard Shortcuts'));

    // The palette closed and handed off to the shortcuts overlay it just ran.
    expect(screen.queryByPlaceholderText('Type a command…')).toBeNull();
    expect(screen.getByText('Keyboard shortcuts')).toBeTruthy();
  });
});

describe('the new dialogs expose an accessible name (aria-labelledby, finding 9)', () => {
  it('the shortcuts overlay is named by its heading', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: '?' });
    // getByRole resolves the accessible name via aria-labelledby → the dialog's
    // heading; it throws if the role="dialog" wrapper has no accessible name.
    expect(screen.getByRole('dialog', { name: /keyboard shortcuts/i })).toBeTruthy();
  });

  it('the command palette carries an accessible name even though it has no visible heading', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true, shiftKey: true });
    expect(screen.getByRole('dialog', { name: /command palette/i })).toBeTruthy();
  });
});

describe('shell smoke — mounting with the new dialogs registered raises no console errors', () => {
  it('renders and opens both dialogs with no console.error', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<App />);
    fireEvent.keyDown(window, { key: '?' });
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true, shiftKey: true });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
