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
});
