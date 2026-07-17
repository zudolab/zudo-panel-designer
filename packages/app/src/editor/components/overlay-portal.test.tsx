// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { OverlayPortal } from './overlay-portal';

afterEach(cleanup);

describe('OverlayPortal', () => {
  it('renders children into #overlay-portal-root when present', () => {
    const root = document.createElement('div');
    root.id = 'overlay-portal-root';
    document.body.appendChild(root);
    try {
      render(
        <OverlayPortal>
          <div>portal-content</div>
        </OverlayPortal>,
      );
      expect(root.textContent).toContain('portal-content');
    } finally {
      root.remove();
    }
  });

  it('falls back to document.body when the portal root is missing', () => {
    expect(document.getElementById('overlay-portal-root')).toBeNull();
    render(
      <OverlayPortal>
        <div>fallback-content</div>
      </OverlayPortal>,
    );
    expect(document.body.textContent).toContain('fallback-content');
  });
});
