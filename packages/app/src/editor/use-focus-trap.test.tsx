// @vitest-environment jsdom
import { useRef, useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useFocusTrap } from './use-focus-trap';

afterEach(cleanup);

function Trap({ active, children }: { active: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, active);
  return <div ref={ref}>{children}</div>;
}

describe('useFocusTrap', () => {
  it('wraps Tab from the last focusable to the first', () => {
    const { container } = render(
      <Trap active>
        <button>first</button>
        <button>middle</button>
        <button>last</button>
      </Trap>,
    );
    const [first, , last] = container.querySelectorAll('button');
    last.focus();
    fireEvent.keyDown(container.firstElementChild!, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  it('wraps Shift+Tab from the first focusable to the last', () => {
    const { container } = render(
      <Trap active>
        <button>first</button>
        <button>middle</button>
        <button>last</button>
      </Trap>,
    );
    const [first, , last] = container.querySelectorAll('button');
    first.focus();
    fireEvent.keyDown(container.firstElementChild!, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('re-queries focusables on every keydown, so a dynamically-added element becomes the wrap target', () => {
    function DynamicTrap() {
      const ref = useRef<HTMLDivElement>(null);
      const [added, setAdded] = useState(false);
      useFocusTrap(ref, true);
      return (
        <div ref={ref}>
          <button onClick={() => setAdded(true)}>first</button>
          <button>middle</button>
          {added && <button>added-last</button>}
        </div>
      );
    }
    const { container, getByText } = render(<DynamicTrap />);
    fireEvent.click(getByText('first'));
    getByText('added-last').focus();
    fireEvent.keyDown(container.firstElementChild!, { key: 'Tab' });
    expect(document.activeElement).toBe(getByText('first'));
  });

  it('does nothing when inactive', () => {
    const { container } = render(
      <Trap active={false}>
        <button>first</button>
        <button>last</button>
      </Trap>,
    );
    const [, last] = container.querySelectorAll('button');
    last.focus();
    fireEvent.keyDown(container.firstElementChild!, { key: 'Tab' });
    expect(document.activeElement).toBe(last);
  });
});
