// Proves the Download JSON button's exact output round-trips: build a doc,
// serialize it through the same panelConfigJson() the download click handler
// calls, JSON.parse it back (the real download/upload boundary), then
// parsePanelConfig it and deep-equal against the original on-screen doc.
import { describe, expect, it } from 'vitest';
import { parsePanelConfig } from '@zpd/core';
import { panelConfigJson } from './download';
import { createDemoDoc } from './demo-doc';

describe('panelConfigJson (the Download JSON path)', () => {
  it('round-trips a doc covering all 5 layer types back to the on-screen doc', () => {
    const doc = createDemoDoc(12);
    const json = panelConfigJson(doc);

    const parsed: unknown = JSON.parse(json);
    const roundTripped = parsePanelConfig(parsed);

    expect(roundTripped).toEqual(doc);
  });

  it('produces pretty-printed JSON containing the version/app/panel envelope', () => {
    const doc = createDemoDoc(6);
    const json = panelConfigJson(doc);
    const parsed = JSON.parse(json);

    expect(parsed.version).toBe(3);
    expect(parsed.app).toBe('zpd');
    expect(parsed.panel.hp).toBe(6);
    expect(parsed.guides).toEqual([]);
    expect(json).toContain('\n'); // pretty-printed (indent: 2), not minified
  });
});
