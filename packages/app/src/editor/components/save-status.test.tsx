// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SaveStatusChip } from './save-status';

afterEach(cleanup);

describe('SaveStatusChip', () => {
  it('renders "Unsaved changes…" for the unsaved state', () => {
    render(<SaveStatusChip status={{ kind: 'unsaved' }} />);
    expect(screen.getByText('Unsaved changes…')).toBeTruthy();
  });

  it('renders "Saved locally HH:MM" for the saved state', () => {
    const savedAt = new Date(2026, 0, 1, 9, 5).getTime();
    render(<SaveStatusChip status={{ kind: 'saved', savedAt }} />);
    expect(screen.getByText('Saved locally 09:05')).toBeTruthy();
  });

  it('renders the quota failure copy for a quota failure', () => {
    render(<SaveStatusChip status={{ kind: 'failed', reason: 'quota' }} />);
    expect(screen.getByText('Save failed (document too large for local storage)')).toBeTruthy();
  });

  it('renders a generic failure label for a non-quota failure', () => {
    render(<SaveStatusChip status={{ kind: 'failed', reason: 'unavailable' }} />);
    expect(screen.getByText('Save failed')).toBeTruthy();
  });

  it('exposes the status via role="status" for assistive tech', () => {
    render(<SaveStatusChip status={{ kind: 'unsaved' }} />);
    expect(screen.getByRole('status')).toBeTruthy();
  });
});
