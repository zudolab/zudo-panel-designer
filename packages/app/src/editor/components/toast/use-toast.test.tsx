// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { useToast, type UseToastResult } from './use-toast';
import { dismissToast, getToasts } from '../../registry/toasts';

function Harness({ onMount }: { onMount: (api: UseToastResult) => void }) {
  const api = useToast();
  useEffect(() => {
    onMount(api);
  });
  return <div>{api.toasts.length} toast(s)</div>;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  for (const t of getToasts()) dismissToast(t.id);
});

describe('useToast', () => {
  it('re-renders with the current toast list as it changes', () => {
    let api!: UseToastResult;
    render(<Harness onMount={(a) => (api = a)} />);
    expect(screen.getByText('0 toast(s)')).toBeTruthy();

    act(() => {
      api.success('Hi', { duration: 999999 });
    });
    expect(screen.getByText('1 toast(s)')).toBeTruthy();
  });

  it('success()/error()/warning() dispatch the matching variant', () => {
    let api!: UseToastResult;
    render(<Harness onMount={(a) => (api = a)} />);

    act(() => {
      api.success('s', { duration: 999999 });
      api.error('e', { duration: 999999 });
      api.warning('w', { duration: 999999 });
    });

    expect(api.toasts.map((t) => t.variant)).toEqual(['success', 'error', 'warning']);
  });

  it('dismiss() removes a toast by id', () => {
    let api!: UseToastResult;
    render(<Harness onMount={(a) => (api = a)} />);

    let id!: string;
    act(() => {
      id = api.success('gone soon', { duration: 999999 });
    });
    expect(screen.getByText('1 toast(s)')).toBeTruthy();

    act(() => {
      api.dismiss(id);
    });
    expect(screen.getByText('0 toast(s)')).toBeTruthy();
  });
});
