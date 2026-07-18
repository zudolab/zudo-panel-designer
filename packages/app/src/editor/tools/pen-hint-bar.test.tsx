// @vitest-environment jsdom
//
// The pen tool has no chrome/hint-bar slot in the ToolModule contract, so it
// mounts its own hint bar (see pen.tsx's onActivate/onDeactivate). This tests
// the presentational half — PenHintBar — in isolation via
// @testing-library/react, the same pattern used by
// inspectors/affordance-hooks.test.tsx: disabled state tracks the semantic
// anchor-count bucket, and each button fires exactly the callback prop it was given (the tool wires
// those callbacks to the very same finishClosed/finishOpen/resetDraft
// functions the pointer/keyboard gestures call, so there's no button-only
// reimplementation to drift out of sync).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PenHintBar } from './pen';

afterEach(cleanup);

function getButton(name: RegExp) {
  return screen.getByRole<HTMLButtonElement>('button', { name });
}

describe('PenHintBar', () => {
  it('with no draft, every button is disabled', () => {
    render(
      <PenHintBar bucket="zero" onClosePath={vi.fn()} onFinishOpen={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(getButton(/Close path/).disabled).toBe(true);
    expect(getButton(/Finish open/).disabled).toBe(true);
    expect(getButton(/Cancel/).disabled).toBe(true);
  });

  it('with 1 anchor, only Cancel is enabled', () => {
    render(
      <PenHintBar bucket="one" onClosePath={vi.fn()} onFinishOpen={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(getButton(/Close path/).disabled).toBe(true);
    expect(getButton(/Finish open/).disabled).toBe(true);
    expect(getButton(/Cancel/).disabled).toBe(false);
  });

  it('with 2 anchors, Finish open and Cancel are enabled but Close path is not', () => {
    render(
      <PenHintBar bucket="two" onClosePath={vi.fn()} onFinishOpen={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(getButton(/Close path/).disabled).toBe(true);
    expect(getButton(/Finish open/).disabled).toBe(false);
    expect(getButton(/Cancel/).disabled).toBe(false);
  });

  it('with 3+ anchors, all three buttons are enabled', () => {
    render(
      <PenHintBar
        bucket="three-plus"
        onClosePath={vi.fn()}
        onFinishOpen={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(getButton(/Close path/).disabled).toBe(false);
    expect(getButton(/Finish open/).disabled).toBe(false);
    expect(getButton(/Cancel/).disabled).toBe(false);
  });

  it('clicking each button fires exactly its own callback', () => {
    const onClosePath = vi.fn();
    const onFinishOpen = vi.fn();
    const onCancel = vi.fn();
    render(
      <PenHintBar
        bucket="three-plus"
        onClosePath={onClosePath}
        onFinishOpen={onFinishOpen}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(getButton(/Close path/));
    expect(onClosePath).toHaveBeenCalledTimes(1);
    expect(onFinishOpen).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.click(getButton(/Finish open/));
    expect(onFinishOpen).toHaveBeenCalledTimes(1);

    fireEvent.click(getButton(/Cancel/));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onClosePath).toHaveBeenCalledTimes(1); // unchanged by the other clicks
    expect(onFinishOpen).toHaveBeenCalledTimes(1);
  });
});
