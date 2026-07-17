// @vitest-environment jsdom
//
// Imports from '../registry' (not '../registry/tools' directly) so the
// import.meta.glob auto-discovery side effect runs and the built-in tools
// (select, pen, ...) are actually registered in this test file's module
// context — see registry/index.ts's isolation note.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { registerTool, unregisterTool } from '../registry';
import { HelpPanel } from './help-panel';

afterEach(cleanup);

describe('HelpPanel', () => {
  it("shows the active tool's label, shortcut, and description (built-in tool)", () => {
    render(<HelpPanel activeToolId="select" />);

    expect(screen.getByText('Select')).toBeTruthy();
    expect(screen.getByText('V')).toBeTruthy();
    expect(screen.getByText(/marquee-select/)).toBeTruthy();
  });

  it('updates live when the active tool id changes', () => {
    const { rerender } = render(<HelpPanel activeToolId="select" />);
    expect(screen.getByText(/marquee-select/)).toBeTruthy();

    rerender(<HelpPanel activeToolId="pen" />);
    expect(screen.queryByText(/marquee-select/)).toBeNull();
    expect(screen.getByText('Pen')).toBeTruthy();
    expect(screen.getByText('P')).toBeTruthy();
    expect(screen.getByText(/bezier handles/)).toBeTruthy();
  });

  it('falls back gracefully for a tool with no description', () => {
    registerTool({ id: 'demo-no-desc', label: 'Demo', shortcut: '9' });
    try {
      render(<HelpPanel activeToolId="demo-no-desc" />);
      expect(screen.getByText('Demo')).toBeTruthy();
      expect(screen.getByText(/No description available/)).toBeTruthy();
    } finally {
      unregisterTool('demo-no-desc');
    }
  });

  it('falls back gracefully for an unknown tool id', () => {
    render(<HelpPanel activeToolId="not-a-real-tool" />);
    expect(screen.getByText('not-a-real-tool')).toBeTruthy();
    expect(screen.getByText(/No description available/)).toBeTruthy();
  });
});
