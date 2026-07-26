// @vitest-environment jsdom
//
// exportGerberZip's crash-safety net (codex review of #215): downloadGerberZip
// can REJECT — a lazy import failing, the kernel throwing outright (see
// kernel-limits.test.ts) — rather than resolve to a structured refusal, and
// both real entry points (header.tsx, commands.ts) call this fire-and-forget.
// Isolated from download-gerber-export.test.tsx (which needs the REAL
// buildGerberIr/engine for its refusal-dialog test) because this file mocks
// buildGerberIr itself to force the rejection deterministically.
import { cleanup } from '@testing-library/react';
import { createDefaultDoc, createPcbLayerStack, type DocState } from '@zpd/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONFIRM_DIALOG_ID, type ConfirmDialogProps } from './components/confirm-dialog';
import { closeDialog, getOpenDialog } from './registry/dialogs';

vi.mock('./gerber/build-ir', () => ({
  buildGerberIr: vi.fn(() => Promise.reject(new Error('path-bool failed to load'))),
}));
vi.mock('./registry/toasts', () => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

afterEach(() => {
  closeDialog();
  cleanup();
  vi.clearAllMocks();
});

describe('exportGerberZip — an unexpected pipeline failure never becomes a silent unhandled rejection', () => {
  it('toasts an error instead of vanishing when buildGerberIr rejects', async () => {
    const { exportGerberZip } = await import('./download');
    const { toastError } = await import('./registry/toasts');

    const doc: DocState = {
      ...createDefaultDoc(),
      panelHp: 12,
      guides: [],
      layers: createPcbLayerStack(),
    };
    const flow = exportGerberZip(doc);

    // Confirm the artwork-only gate, same as a real "Export .zip" click.
    const open = getOpenDialog();
    expect(open?.id).toBe(CONFIRM_DIALOG_ID);
    (open!.props as ConfirmDialogProps).onConfirm();
    closeDialog();

    // No dangling promise, no exception escaping to the caller — this await
    // is itself part of what the test proves: without the try/catch this
    // fix adds, `flow` rejects here instead of resolving.
    await flow;

    expect(toastError).toHaveBeenCalledWith('Gerber export failed', {
      description: 'path-bool failed to load',
    });
    // No refusal dialog either — the failure is unstructured, not a
    // GerberRefusal, so there is nothing left open to acknowledge.
    expect(getOpenDialog()).toBeNull();
  });
});
