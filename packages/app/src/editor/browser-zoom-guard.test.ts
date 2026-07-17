// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { installBrowserZoomGuard } from './browser-zoom-guard';

function dispatchWheel(init: WheelEventInit) {
  const event = new WheelEvent('wheel', { cancelable: true, ...init });
  window.dispatchEvent(event);
  return event;
}

function dispatchKeyDown(init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { cancelable: true, ...init });
  window.dispatchEvent(event);
  return event;
}

function dispatchGesture(type: 'gesturestart' | 'gesturechange' | 'gestureend') {
  const event = new Event(type, { cancelable: true });
  document.dispatchEvent(event);
  return event;
}

let uninstall: (() => void) | undefined;

afterEach(() => {
  uninstall?.();
  uninstall = undefined;
});

describe('installBrowserZoomGuard', () => {
  it('prevents ctrl+wheel and meta+wheel (pinch delivers as ctrlKey wheel)', () => {
    uninstall = installBrowserZoomGuard();
    expect(dispatchWheel({ ctrlKey: true }).defaultPrevented).toBe(true);
    expect(dispatchWheel({ metaKey: true }).defaultPrevented).toBe(true);
  });

  it('does not prevent a plain (unmodified) wheel event', () => {
    uninstall = installBrowserZoomGuard();
    expect(dispatchWheel({}).defaultPrevented).toBe(false);
  });

  it('prevents cmd/ctrl + plus, equals, minus, and zero', () => {
    uninstall = installBrowserZoomGuard();
    expect(dispatchKeyDown({ ctrlKey: true, key: '+' }).defaultPrevented).toBe(true);
    expect(dispatchKeyDown({ ctrlKey: true, key: '=' }).defaultPrevented).toBe(true);
    expect(dispatchKeyDown({ metaKey: true, key: '-' }).defaultPrevented).toBe(true);
    expect(dispatchKeyDown({ metaKey: true, key: '0' }).defaultPrevented).toBe(true);
  });

  it('does not prevent an unmodified "+" or an unrelated modified key', () => {
    uninstall = installBrowserZoomGuard();
    expect(dispatchKeyDown({ key: '+' }).defaultPrevented).toBe(false);
    expect(dispatchKeyDown({ ctrlKey: true, key: 'a' }).defaultPrevented).toBe(false);
  });

  it('prevents Safari gesture events', () => {
    uninstall = installBrowserZoomGuard();
    expect(dispatchGesture('gesturestart').defaultPrevented).toBe(true);
    expect(dispatchGesture('gesturechange').defaultPrevented).toBe(true);
    expect(dispatchGesture('gestureend').defaultPrevented).toBe(true);
  });

  it('stops preventing default once uninstalled', () => {
    const stop = installBrowserZoomGuard();
    stop();
    expect(dispatchWheel({ ctrlKey: true }).defaultPrevented).toBe(false);
    expect(dispatchKeyDown({ ctrlKey: true, key: '+' }).defaultPrevented).toBe(false);
    expect(dispatchGesture('gesturestart').defaultPrevented).toBe(false);
  });
});
