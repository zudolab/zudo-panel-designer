import { afterEach, describe, expect, it } from 'vitest';
import { closeDialog, getOpenDialog, openDialog } from './dialogs';

afterEach(() => {
  closeDialog();
});

describe('dialog store', () => {
  it('opens safely without DOM globals', () => {
    expect(typeof document).toBe('undefined');
    expect(() => openDialog('node-safe')).not.toThrow();
    expect(getOpenDialog()).toMatchObject({
      id: 'node-safe',
      returnFocusTarget: null,
    });
  });
});
