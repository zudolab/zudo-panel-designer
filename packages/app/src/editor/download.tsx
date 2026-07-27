// Download the panel config JSON — the stage-1 order artifact. Uses core's
// canonical serializePanelConfig so the shape matches what the fab reader
// expects. panelConfigJson is split out (pure, DOM-free) so the exact string
// the download button produces is unit-testable without a real Blob/anchor.
//
// downloadGerberZip (#215) follows the exact same split: buildGerberIr() +
// gerberZipBytes() are pure/DOM-free (unit-tested in gerber/build-ir.test.ts
// and gerber/zip.test.ts), and only the Blob/anchor mechanics below are
// shared between the two DOM shells.
import type { ReactNode } from 'react';
import { panelHeightMm, panelWidthMm, serializePanelConfig, type DocState } from '@zpd/core';
// package.json's `version` field, read at build time via TS's resolveJsonModule
// — the same string writer.ts's %TF.GenerationSoftware,...*% attribute needs
// (Decision 3.3), with no separate version constant to keep in sync by hand.
import packageJson from '../../package.json';
import { confirmDialog } from './components/confirm-dialog-api';
// The whole Gerber pipeline is behind `await import(...)` below, never a static
// import. It is reachable from the header (and therefore from the app entry),
// so a static import drags build-ir + extract + stroker + flatten + regions +
// the pattern recorder + the writer + fflate into the MAIN chunk, parsed on
// every page load for a feature that only runs on an export click. Type-only
// imports are fine — they erase.
import {
  GERBER_EXPORT_SCOPE_STATEMENT,
  PCB_MATERIAL_LABEL,
} from './gerber/artwork-only-statement';
import type { GerberRefusal } from './gerber/ir';
import type { GerberEmitOptions } from './gerber/writer';
import { toastError, toastSuccess } from './registry/toasts';

export function panelConfigJson(doc: DocState): string {
  return JSON.stringify(serializePanelConfig(doc), null, 2);
}

// Deferred revocation to a later tick: revoking in the same tick as click()
// can abort the download before the browser has read the blob in some
// browsers (both downloadPanelConfig and downloadGerberZip below rely on this).
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadPanelConfig(doc: DocState): void {
  triggerDownload(
    new Blob([panelConfigJson(doc)], { type: 'application/json' }),
    `zpd-panel-${doc.panelHp}hp.json`,
  );
}

export type GerberDownloadResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly refusals: readonly GerberRefusal[] };

function gerberEmitOptionsNow(): GerberEmitOptions {
  // Decision 3.3: TF.CreationDate is an explicit parameter of the pure writer,
  // never Date.now() read inside it — this is the one place the real clock is
  // read, matching download.ts's split of pure generation from its DOM shell.
  return { creationDate: new Date().toISOString(), softwareVersion: packageJson.version };
}

/**
 * Builds the Gerber IR (Decision 8's refusals collected, never partial) and,
 * only when it succeeds, zips and downloads it. A refusal never reaches
 * `Blob`/`URL.createObjectURL` — no file is produced, per Decision 8.
 */
export async function downloadGerberZip(doc: DocState): Promise<GerberDownloadResult> {
  const [{ buildGerberIr }, { gerberZipBytes, gerberZipFilename }] = await Promise.all([
    import('./gerber/build-ir'),
    import('./gerber/zip'),
  ]);
  const result = await buildGerberIr(doc);
  if (!result.ok) return result;
  const bytes = gerberZipBytes(result.ir, gerberEmitOptionsNow());
  triggerDownload(
    new Blob([bytes], { type: 'application/zip' }),
    gerberZipFilename(doc.format, doc.material, doc.panelHp),
  );
  return { ok: true };
}

function refusalListNode(refusals: readonly GerberRefusal[]): ReactNode {
  return (
    <ul className="flex flex-col gap-2 text-left text-xs text-neutral-300">
      {refusals.map((refusal) => (
        <li key={refusal.code}>
          <p>{refusal.message}</p>
          {refusal.layers.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-neutral-400">
              {refusal.layers.map((layer) => (
                <li key={layer.id}>{layer.name}</li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * The user-facing Gerber export flow (#215) both the header button and the
 * "Download Gerber (.zip)" palette command call — a confirm gate stating
 * Decision 2.4's export-scope statement BEFORE the download happens, then
 * `downloadGerberZip`, then — if `buildGerberIr` refused — a dialog naming
 * EVERY refusal together (Decision 8: never a console warning, never a silent
 * skip). Reuses confirm-dialog.tsx (via its imperative `confirmDialog()`
 * helper) for both steps rather than a bespoke dialog: the export-scope
 * notice is exactly what that component is for — a message the user must see
 * before an action proceeds — and the refusal list is the same primitive with
 * `children` standing in for a free-form body, so there is a single owner of
 * dialog chrome (backdrop, focus trap, Escape) for the whole flow.
 *
 * Takes `doc` rather than a full `ToolContext`, matching `downloadPanelConfig`
 * — everything else it needs (the dialog registry, the toast queue) is a
 * module-level import, not context.
 *
 * `downloadGerberZip` can REJECT rather than resolve to a refusal — the
 * kernel's lazy `import('path-bool')`, the outliner's lazy `opentype.js` +
 * font fetch, or the union itself (measurably capable of throwing outright,
 * see `kernel-limits.test.ts`) can all fail for reasons Decision 8's refusal
 * codes don't model. Both entry points (header.tsx, commands.ts) call this
 * fire-and-forget (`void exportGerberZip(...)`), so an uncaught rejection
 * here would be a genuinely silent failure — no dialog, no toast, nothing —
 * which is exactly the outcome the whole refusal system exists to prevent.
 * The try/catch below is that same "never silent" rule applied to the
 * unexpected-crash case, not only the anticipated-refusal one.
 */
export async function exportGerberZip(doc: DocState): Promise<void> {
  const widthMm = panelWidthMm(doc.panelHp);
  const confirmed = await confirmDialog({
    title: 'Export Gerber (.zip)',
    message: `${GERBER_EXPORT_SCOPE_STATEMENT} Panel: ${doc.format} ${doc.panelHp}HP, ${widthMm} × ${panelHeightMm(doc.format)} mm, ${PCB_MATERIAL_LABEL[doc.material]}.`,
    confirmLabel: 'Export .zip',
    cancelLabel: 'Cancel',
  });
  if (!confirmed) return;

  try {
    const result = await downloadGerberZip(doc);
    if (result.ok) {
      toastSuccess('Gerber export downloaded');
      return;
    }
    // Both buttons just dismiss — this is an acknowledgement, not a real
    // yes/no choice — so the resolved boolean is intentionally unused.
    await confirmDialog({
      title: `Gerber export blocked — ${result.refusals.length} issue${result.refusals.length === 1 ? '' : 's'}`,
      children: refusalListNode(result.refusals),
      confirmLabel: 'OK',
      danger: true,
    });
  } catch (error) {
    toastError('Gerber export failed', {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}
