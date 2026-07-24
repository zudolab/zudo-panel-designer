// @vitest-environment jsdom
//
// Proves NumberField's commit contract: it holds a local draft while focused,
// so typing never commits per-keystroke and a cleared field never snaps to 0.
// One discrete edit == exactly one commit (on blur or Enter); arrow keys step
// discretely; and an external value change (undo/redo, a canvas drag) syncs the
// draft while the field isn't being edited.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MaterialField, NumberField } from './inspector-ui';

afterEach(cleanup);

describe('NumberField', () => {
  it('does not commit while typing — only once on blur', () => {
    const onCommit = vi.fn();
    const { getByRole } = render(<NumberField value={5} onCommit={onCommit} />);
    const input = getByRole('spinbutton') as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.change(input, { target: { value: '25' } });
    fireEvent.change(input, { target: { value: '250' } });
    expect(onCommit).not.toHaveBeenCalled(); // no per-keystroke commit

    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(250);
  });

  it('commits once on Enter', () => {
    const onCommit = vi.fn();
    const { getByRole } = render(<NumberField value={5} onCommit={onCommit} />);
    const input = getByRole('spinbutton') as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '12.5' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(12.5);
  });

  it('a cleared field reverts to the last valid value instead of committing 0', () => {
    const onCommit = vi.fn();
    const { getByRole } = render(<NumberField value={5} onCommit={onCommit} />);
    const input = getByRole('spinbutton') as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);

    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe('5'); // reverted, not snapped to 0
  });

  it('does not commit when the value is unchanged', () => {
    const onCommit = vi.fn();
    const { getByRole } = render(<NumberField value={5} onCommit={onCommit} />);
    const input = getByRole('spinbutton') as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.blur(input);

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('arrow up/down steps discretely — one commit per press', () => {
    const onCommit = vi.fn();
    const { getByRole } = render(<NumberField value={5} step={1} onCommit={onCommit} />);
    const input = getByRole('spinbutton') as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenLastCalledWith(6);
  });

  it('keeps a fractional step clean (no float noise)', () => {
    const onCommit = vi.fn();
    const { getByRole } = render(<NumberField value={6} step={0.1} onCommit={onCommit} />);
    const input = getByRole('spinbutton') as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onCommit).toHaveBeenLastCalledWith(6.1); // not 6.099999999999999
  });

  it('syncs the draft to an external value change while not editing', () => {
    const onCommit = vi.fn();
    const { getByRole, rerender } = render(<NumberField value={5} onCommit={onCommit} />);
    const input = getByRole('spinbutton') as HTMLInputElement;
    expect(input.value).toBe('5');

    rerender(<NumberField value={8} onCommit={onCommit} />);
    expect(input.value).toBe('8'); // e.g. undo/redo or a canvas drag moved it
  });
});

describe('MaterialField', () => {
  it('adds an opening-semantics hint only for the solder-mask role', () => {
    render(<MaterialField role="solder-mask" />);
    expect(screen.getByText(/open the mask/i)).toBeTruthy();
  });

  it('does not show the opening hint for other roles', () => {
    render(<MaterialField role="copper" />);
    expect(screen.queryByText(/open the mask/i)).toBeNull();
  });

  it('does not show the opening hint when unassigned', () => {
    render(<MaterialField role={null} />);
    expect(screen.queryByText(/open the mask/i)).toBeNull();
    expect(screen.getByText('Unassigned')).toBeTruthy();
  });
});
