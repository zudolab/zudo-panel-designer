// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Tooltip } from './tooltip';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function stubRect(el: Element, rect: Partial<DOMRect>) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON() {},
    ...rect,
  } as DOMRect);
}

// getByRole excludes aria-hidden elements by default; the tooltip stays
// mounted (aria-hidden toggling) rather than unmounting, so always opt in.
function getTooltip() {
  return screen.getByRole('tooltip', { hidden: true });
}

describe('Tooltip', () => {
  it('honors the configured delay: hidden before it elapses, visible after', () => {
    vi.useFakeTimers();
    render(
      <Tooltip content="Hint" delay={300}>
        <button>Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });

    fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
    expect(getTooltip().getAttribute('aria-hidden')).toBe('true');

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(getTooltip().getAttribute('aria-hidden')).toBe('true');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(getTooltip().getAttribute('aria-hidden')).toBe('false');
  });

  it('cancels the pending show when the pointer leaves before the delay elapses', () => {
    vi.useFakeTimers();
    render(
      <Tooltip content="Hint" delay={300}>
        <button>Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });

    fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    fireEvent.pointerLeave(trigger, { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(getTooltip().getAttribute('aria-hidden')).toBe('true');
  });

  it('ignores touch pointer events', () => {
    vi.useFakeTimers();
    render(
      <Tooltip content="Hint" delay={300}>
        <button>Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });

    fireEvent.pointerEnter(trigger, { pointerType: 'touch' });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(getTooltip().getAttribute('aria-hidden')).toBe('true');
  });

  it('shows on keyboard focus and hides on blur', () => {
    vi.useFakeTimers();
    render(
      <Tooltip content="Hint" delay={0}>
        <button>Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });

    fireEvent.focus(trigger);
    act(() => {
      vi.runAllTimers();
    });
    expect(getTooltip().getAttribute('aria-hidden')).toBe('false');

    fireEvent.blur(trigger);
    expect(getTooltip().getAttribute('aria-hidden')).toBe('true');
  });

  it('flips placement when the preferred side would overflow the viewport', () => {
    vi.useFakeTimers();
    render(
      <Tooltip content="Hint" placement="top" delay={0}>
        <button>Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    // Near the top edge: placement="top" would put the tooltip above y=0,
    // so it should flip to "bottom" instead.
    stubRect(trigger, { top: 2, left: 100, right: 140, bottom: 22, width: 40, height: 20 });

    fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
    act(() => {
      vi.runAllTimers();
    });

    const tooltip = getTooltip();
    // Flipped to bottom: trigger.bottom (22) + GAP (6) = 28.
    expect(tooltip.style.top).toBe('28px');
  });

  it('does not flip when the preferred side fits', () => {
    vi.useFakeTimers();
    render(
      <Tooltip content="Hint" placement="bottom" delay={0}>
        <button>Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    stubRect(trigger, { top: 300, left: 100, right: 140, bottom: 320, width: 40, height: 20 });

    fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
    act(() => {
      vi.runAllTimers();
    });

    const tooltip = getTooltip();
    // Not flipped: trigger.bottom (320) + GAP (6) = 326.
    expect(tooltip.style.top).toBe('326px');
  });

  it('wraps a disabled child in an event-relay span and still shows the tooltip', () => {
    vi.useFakeTimers();
    render(
      <Tooltip content="Hint" delay={0}>
        <button disabled>Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    const wrapper = trigger.parentElement as HTMLElement;
    expect(wrapper.tagName).toBe('SPAN');
    expect(wrapper.style.pointerEvents).toBe('auto');

    fireEvent.pointerEnter(wrapper, { pointerType: 'mouse' });
    act(() => {
      vi.runAllTimers();
    });
    expect(getTooltip().getAttribute('aria-hidden')).toBe('false');
  });

  it('suppresses the tooltip entirely when disabled', () => {
    vi.useFakeTimers();
    render(
      <Tooltip content="Hint" delay={0} disabled>
        <button>Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });

    fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
    act(() => {
      vi.runAllTimers();
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('composes with the child\'s own handlers instead of overwriting them', () => {
    vi.useFakeTimers();
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    const onPointerEnter = vi.fn();
    const onPointerLeave = vi.fn();
    render(
      <Tooltip content="Hint" delay={0}>
        <button
          onFocus={onFocus}
          onBlur={onBlur}
          onPointerEnter={onPointerEnter}
          onPointerLeave={onPointerLeave}
        >
          Trigger
        </button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });

    fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
    fireEvent.pointerLeave(trigger, { pointerType: 'mouse' });
    fireEvent.focus(trigger);
    fireEvent.blur(trigger);

    expect(onPointerEnter).toHaveBeenCalledTimes(1);
    expect(onPointerLeave).toHaveBeenCalledTimes(1);
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it('merges with an existing aria-describedby instead of replacing it', () => {
    vi.useFakeTimers();
    render(
      <Tooltip content="Hint" delay={0}>
        <button aria-describedby="existing-hint">Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    expect(trigger.getAttribute('aria-describedby')).toBe('existing-hint');

    fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
    act(() => {
      vi.runAllTimers();
    });

    const describedBy = trigger.getAttribute('aria-describedby');
    expect(describedBy).toContain('existing-hint');
    expect(describedBy).toContain(getTooltip().id);
  });
});
