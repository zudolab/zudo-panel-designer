// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CollapsibleSection } from './collapsible-section';

afterEach(cleanup);

function StatefulBody() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount((value) => value + 1)}>Count {count}</button>;
}

describe('CollapsibleSection', () => {
  it('defaults to open: content visible, chevron down, aria-expanded true', () => {
    render(
      <CollapsibleSection title="Panel">
        <p>Body content</p>
      </CollapsibleSection>,
    );

    expect(screen.getByText('Body content')).toBeTruthy();
    const button = screen.getByRole('button', { name: /Panel/ });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.textContent).toContain('▾');
  });

  it('respects defaultOpen={false}: content hidden, chevron right, aria-expanded false', () => {
    render(
      <CollapsibleSection title="Palette" defaultOpen={false}>
        <p>Body content</p>
      </CollapsibleSection>,
    );

    expect(screen.queryByText('Body content')).toBeNull();
    const button = screen.getByRole('button', { name: /Palette/ });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.textContent).toContain('▸');
  });

  it('clicking the header toggles content visibility and aria-expanded', () => {
    render(
      <CollapsibleSection title="Layers">
        <p>Body content</p>
      </CollapsibleSection>,
    );

    const button = screen.getByRole('button', { name: /Layers/ });
    fireEvent.click(button);
    expect(screen.queryByText('Body content')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(button);
    expect(screen.getByText('Body content')).toBeTruthy();
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  it('wires aria-controls to the rendered content id', () => {
    render(
      <CollapsibleSection title="Properties">
        <p>Body content</p>
      </CollapsibleSection>,
    );

    const button = screen.getByRole('button', { name: /Properties/ });
    const controlsId = button.getAttribute('aria-controls');
    expect(controlsId).toBeTruthy();
    expect(document.getElementById(controlsId as string)).not.toBeNull();
  });

  it('can keep stateful content mounted while hiding it', () => {
    render(
      <CollapsibleSection title="Layers" keepMounted>
        <StatefulBody />
      </CollapsibleSection>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Count 0' }));
    const toggle = screen.getByRole('button', { name: /Layers/ });
    const content = document.getElementById(toggle.getAttribute('aria-controls')!);

    fireEvent.click(toggle);
    expect(content?.hidden).toBe(true);
    expect(screen.queryByRole('button', { name: 'Count 1' })).toBeNull();

    fireEvent.click(toggle);
    expect(content?.hidden).toBe(false);
    expect(screen.getByRole('button', { name: 'Count 1' })).toBeTruthy();
  });
});
