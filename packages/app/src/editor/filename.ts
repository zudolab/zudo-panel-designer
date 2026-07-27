// Shared download-filename helper (#229): every export filename encodes the
// document's format and hp — and, for the Gerber zip, its material — so a
// downloaded file's name alone identifies which panel variant it came from.
// download.tsx (JSON) and gerber/zip.ts (Gerber zip) both build their
// filename through here rather than inlining the pattern, so the two never
// drift apart.
import type { DocState } from '@zpd/core';

/** `zpd-panel-<format>-<hp>hp.json`, the panel-config JSON download. */
export function panelConfigFilename(doc: Pick<DocState, 'format' | 'panelHp'>): string {
  return `zpd-panel-${doc.format}-${doc.panelHp}hp.json`;
}

/** `zpd-panel-<format>-<hp>hp-<material>-gerber.zip`, the Gerber export. */
export function gerberZipFilename(doc: Pick<DocState, 'format' | 'panelHp' | 'material'>): string {
  return `zpd-panel-${doc.format}-${doc.panelHp}hp-${doc.material}-gerber.zip`;
}
