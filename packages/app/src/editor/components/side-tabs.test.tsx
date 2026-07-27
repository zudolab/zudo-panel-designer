// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SideTabs } from './side-tabs';

afterEach(cleanup);

describe('SideTabs (#233)', () => {
  it('renders Front and Back tabs for fr4 with aria-selected on the active one', () => {
    render(<SideTabs activeSide="front" material="fr4" onSideChange={() => {}} />);
    const front = screen.getByRole('tab', { name: 'Front' });
    const back = screen.getByRole('tab', { name: 'Back' });
    expect(front.getAttribute('aria-selected')).toBe('true');
    expect(back.getAttribute('aria-selected')).toBe('false');
  });

  it('marks Back selected when it is the active side', () => {
    render(<SideTabs activeSide="back" material="fr4" onSideChange={() => {}} />);
    expect(screen.getByRole('tab', { name: 'Back' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Front' }).getAttribute('aria-selected')).toBe('false');
  });

  it('renders NO Back tab for alumi (front-only material)', () => {
    render(<SideTabs activeSide="front" material="alumi" onSideChange={() => {}} />);
    expect(screen.getByRole('tab', { name: 'Front' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Back' })).toBeNull();
  });

  it('clicking a tab reports that side via onSideChange', () => {
    const onSideChange = vi.fn();
    render(<SideTabs activeSide="front" material="fr4" onSideChange={onSideChange} />);
    screen.getByRole('tab', { name: 'Back' }).click();
    expect(onSideChange).toHaveBeenCalledWith('back');
    // Re-clicking the active tab still reports — the same-side no-op lives
    // in ctx.setActiveSide, not here.
    screen.getByRole('tab', { name: 'Front' }).click();
    expect(onSideChange).toHaveBeenCalledWith('front');
  });
});
