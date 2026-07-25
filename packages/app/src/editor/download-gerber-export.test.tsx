// @vitest-environment jsdom
//
// exportGerberZip's UI contract (#215, Decision 2.4 / Decision 8), driven
// through the REAL dialog registry rather than a rendered <DialogHost/> —
// confirmDialog()'s openDialog() call is synchronous (registry/dialogs.ts),
// so the confirm-gate's props are inspectable the instant exportGerberZip is
// called, with no waitFor needed for that half. The refusal dialog's props
// are inspected the same way, then its onConfirm resolves the whole flow —
// this proves exportGerberZip's OWN control flow end to end (real
// buildGerberIr, real confirm-dialog.tsx props shape) without needing a
// forbidden headless-browser pass.
import { cleanup, render, screen } from '@testing-library/react';
import { createPcbLayerStack, type DocState } from '@zpd/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONFIRM_DIALOG_ID, type ConfirmDialogProps } from './components/confirm-dialog';
import { closeDialog, getOpenDialog } from './registry/dialogs';
import { exportGerberZip } from './download';
import { GERBER_ARTWORK_ONLY_STATEMENT } from './gerber/zip';

afterEach(() => {
  closeDialog();
  cleanup();
});

function confirmGateProps(): ConfirmDialogProps {
  const open = getOpenDialog();
  expect(open?.id).toBe(CONFIRM_DIALOG_ID);
  return open!.props as ConfirmDialogProps;
}

describe('exportGerberZip — the artwork-only statement (Decision 2.4)', () => {
  it('is shown, word for word, BEFORE downloadGerberZip/buildGerberIr ever runs', () => {
    const doc: DocState = { panelHp: 12, guides: [], layers: createPcbLayerStack() };
    // Not awaited: confirmDialog()'s openDialog() call is synchronous, and
    // nothing past it (buildGerberIr, the engine) has started yet — this
    // assertion needs none of that machinery.
    void exportGerberZip(doc);

    const props = confirmGateProps();
    expect(props.title).toBe('Export Gerber (.zip)');
    expect(props.message).toContain(GERBER_ARTWORK_ONLY_STATEMENT);
    expect(props.message).toContain('12HP');
  });

  it('a Cancel click aborts before any export happens (no refusal/success dialog follows)', async () => {
    const doc: DocState = { panelHp: 12, guides: [], layers: createPcbLayerStack() };
    const flow = exportGerberZip(doc);
    // Cancel/Escape/backdrop all resolve confirmDialog() to false via the
    // SAME mechanism (registry/dialogs.ts identity check) — closeDialog()
    // reproduces that without needing a real click.
    closeDialog();
    await flow;
    expect(getOpenDialog()).toBeNull();
  });
});

describe('exportGerberZip — refusals are a loud dialog naming the offending layers (Decision 8)', () => {
  it('names the unlisted-panel-hp refusal once the export is confirmed', async () => {
    // panelHp 7 has no PANEL_SIZES entry (Decision 8) — an empty layer stack
    // keeps buildGerberIr's own work (beyond engine construction) minimal.
    const doc: DocState = { panelHp: 7, guides: [], layers: createPcbLayerStack() };
    const flow = exportGerberZip(doc);

    // Confirm the artwork-only gate exactly as a real "Export .zip" click
    // would: confirm-dialog.tsx's button calls props.onConfirm() then close().
    confirmGateProps().onConfirm();
    closeDialog();

    await vi.waitFor(
      () => {
        const open = getOpenDialog();
        expect(open?.id).toBe(CONFIRM_DIALOG_ID);
        expect((open!.props as ConfirmDialogProps).title).toContain('blocked');
      },
      { timeout: 15_000 },
    );

    const refusalProps = getOpenDialog()!.props as ConfirmDialogProps;
    render(<div>{refusalProps.children}</div>);
    expect(screen.getByText(/only an approximation|not an order-ready/i)).toBeTruthy();

    // Acknowledge, same as a real click, so the flow's own promise settles.
    refusalProps.onConfirm();
    await flow;
  }, 20_000);
});
