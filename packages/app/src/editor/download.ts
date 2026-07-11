// Download the panel config JSON — the stage-1 order artifact. Uses core's
// canonical serializePanelConfig so the shape matches what the fab reader
// expects. (Wave 4 owns the polished export UX; this keeps the button live.)
import { serializePanelConfig, type DocState } from '@zpd/core';

export function downloadPanelConfig(doc: DocState): void {
  const json = JSON.stringify(serializePanelConfig(doc), null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `zpd-panel-${doc.panelHp}hp.json`;
  a.click();
  URL.revokeObjectURL(url);
}
