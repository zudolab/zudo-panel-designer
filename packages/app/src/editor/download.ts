// Download the panel config JSON — the stage-1 order artifact. Uses core's
// canonical serializePanelConfig so the shape matches what the fab reader
// expects. panelConfigJson is split out (pure, DOM-free) so the exact string
// the download button produces is unit-testable without a real Blob/anchor.
import { serializePanelConfig, type DocState } from '@zpd/core';

export function panelConfigJson(doc: DocState): string {
  return JSON.stringify(serializePanelConfig(doc), null, 2);
}

export function downloadPanelConfig(doc: DocState): void {
  const blob = new Blob([panelConfigJson(doc)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `zpd-panel-${doc.panelHp}hp.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Defer revocation to a later tick: revoking in the same tick as click() can
  // abort the download before the browser has read the blob in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
