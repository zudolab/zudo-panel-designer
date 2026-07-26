// Proves the Download JSON button's exact output round-trips: build a doc,
// serialize it through the same panelConfigJson() the download click handler
// calls, JSON.parse it back (the real download/upload boundary), then
// parsePanelConfig it and deep-equal against the original on-screen doc.
//
// downloadGerberZip's DOM-touching success path (Blob/URL.createObjectURL) is
// deliberately NOT covered here, matching the pre-existing convention for
// downloadPanelConfig's own DOM shell: commands.test.ts proves the wiring
// with a mock, gerber/zip.test.ts and gerber/build-ir.test.ts cover the pure
// pipeline it calls. What IS covered below is the refusal short-circuit,
// which is real, DOM-free behavior of downloadGerberZip itself — a refusal
// returns before ANY Blob/anchor code runs (Decision 8: no file produced).
import { describe, expect, it } from 'vitest';
import { parsePanelConfig } from '@zpd/core';
import { downloadGerberZip, panelConfigJson } from './download';
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

    expect(parsed.version).toBe(6);
    expect(parsed.app).toBe('zpd');
    expect(parsed.panel.hp).toBe(6);
    expect(parsed.guides).toEqual([]);
    expect(json).toContain('\n'); // pretty-printed (indent: 2), not minified
  });
});

describe('downloadGerberZip — the refusal short-circuit (Decision 8)', () => {
  it('returns collected refusals without touching Blob/URL/document, for an unlisted panel HP', async () => {
    // 7 has no PANEL_SIZES entry (DECISIONS.md Decision 8) — panelWidthMm
    // falls back to an approximation, so the export must refuse. This runs in
    // vitest's plain node environment (no jsdom): if this branch reached
    // triggerDownload()'s Blob/document.createElement calls, it would throw
    // ReferenceError here rather than resolve — the absence of that error IS
    // part of what this test proves.
    const doc = { ...createDemoDoc(12), panelHp: 7 };
    const result = await downloadGerberZip(doc);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusals.map((r) => r.code)).toContain('unlisted-panel-hp');
  });
});
