// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChromeButton } from './chrome';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ChromeButton', () => {
  it('shows its tooltip prop content on hover and hides it on pointer leave', () => {
    vi.useFakeTimers();
    render(<ChromeButton tooltip="Pen tool">P</ChromeButton>);
    const button = screen.getByRole('button', { name: 'Pen tool' });

    fireEvent.pointerEnter(button, { pointerType: 'mouse' });
    act(() => {
      vi.runAllTimers();
    });
    expect(screen.getByRole('tooltip', { hidden: true }).textContent).toBe('Pen tool');
    expect(screen.getByRole('tooltip', { hidden: true }).getAttribute('aria-hidden')).toBe('false');

    fireEvent.pointerLeave(button, { pointerType: 'mouse' });
    expect(screen.getByRole('tooltip', { hidden: true }).getAttribute('aria-hidden')).toBe('true');
  });

  it('shows its tooltip on keyboard focus, and hiding still works after a click leaves the button focused', () => {
    vi.useFakeTimers();
    render(<ChromeButton tooltip="Undo">U</ChromeButton>);
    const button = screen.getByRole('button', { name: 'Undo' });

    fireEvent.focus(button);
    act(() => {
      vi.runAllTimers();
    });
    expect(screen.getByRole('tooltip', { hidden: true }).getAttribute('aria-hidden')).toBe('false');

    // A mouse click leaves the button focused without a blur event, but the
    // pointer leaving must still hide the tooltip (no CSS focus-visible
    // trick backing this anymore — Tooltip's onPointerLeave handles it).
    fireEvent.pointerLeave(button, { pointerType: 'mouse' });
    expect(screen.getByRole('tooltip', { hidden: true }).getAttribute('aria-hidden')).toBe('true');
  });

  it('falls back to the native title attribute when no tooltip prop is given', () => {
    render(<ChromeButton title="Zoom in">+</ChromeButton>);
    const button = screen.getByRole('button', { name: '+' });
    expect(button.getAttribute('title')).toBe('Zoom in');
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
  });

  // Issue #205: an icon child (an inline SVG) is a block box under Tailwind
  // v4 preflight (`svg { display: block }`, `* { margin: 0 }`), so neither
  // the button's UA text-align nor auto-margins can centre it — the button
  // itself must establish a flex centering context on both axes.
  it('centres its content on both axes via inline-flex + items-center + justify-center (#205)', () => {
    render(<ChromeButton title="Undo">U</ChromeButton>);
    const button = screen.getByRole('button', { name: 'U' });
    expect(button.className).toContain('inline-flex');
    expect(button.className).toContain('items-center');
    expect(button.className).toContain('justify-center');
  });

  it('keeps centering classes even when a caller passes its own className', () => {
    render(
      <ChromeButton title="Zoom out" className="h-8 w-8 !px-0">
        −
      </ChromeButton>,
    );
    const button = screen.getByRole('button', { name: '−' });
    expect(button.className).toContain('inline-flex');
    expect(button.className).toContain('items-center');
    expect(button.className).toContain('justify-center');
    expect(button.className).toContain('h-8');
    expect(button.className).toContain('w-8');
  });
});
