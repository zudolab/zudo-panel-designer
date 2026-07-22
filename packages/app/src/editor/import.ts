// Shared file-import dispatch (#75): both the document-level drop handler
// (components/drop-import.tsx) and the header's "Import JSON" button route
// through this module so a file dropped or picked takes the exact same path
// — an image/SVG becomes a layer via importImageFile(); a .json file is
// validated with core's STRICT tryParsePanelConfig (not the lenient
// parsePanelConfig, which would silently accept `{}` as an empty document)
// and, only after the user confirms, replaces the whole document.
import { tryParsePanelConfig } from '@zpd/core';
import { confirmDialog } from './components/confirm-dialog-api';
import { replaceDoc } from './replace-doc';
import { toastError, toastSuccess } from './registry/toasts';
import { routeImportFile } from './svg-import/route-import-file';
import type { ToolContext } from './types';

function isJsonFile(file: File): boolean {
  return file.type === 'application/json' || file.name.toLowerCase().endsWith('.json');
}

export function isImportableImageFile(file: File): boolean {
  return (
    file.type.startsWith('image/') ||
    file.name.toLowerCase().endsWith('.svg') ||
    // No image/* MIME AND no recognized extension (e.g. a filesystem file
    // with no suffix) -- rather than reject outright, let classifyImportFile's
    // own content root-sniff (#138) have the final say. Mirrors the same
    // "anonymous blob" allowance use-clipboard.ts already makes for
    // clipboard-pasted files (#141, #143): a genuinely unsupported file still
    // ends up at routeImportFile's identical "Unsupported file" toast, just
    // one classify() hop later. Excludes .json: some platforms report an
    // empty MIME for it too, and isImportableImageFile is checked BEFORE
    // isJsonFile in importDroppedFile below -- without this exclusion, such
    // a file would be misrouted to the image path and rejected as
    // "Unsupported file" instead of reaching the panel-JSON import flow
    // (caught by codex review during #143's integration pass).
    (file.type === '' && !isJsonFile(file))
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// The JSON half of the import path: parse -> strict-validate -> confirm ->
// replace. Shared verbatim by the drop handler and the header button so
// "exact same code path" (issue #75) is literally one function, not two call
// sites kept in sync by hand. The document is left untouched on every
// rejection branch — confirmDialog/replaceDoc only run once tryParsePanelConfig
// has already said the envelope is a real zpd panel config.
export async function importJsonFile(file: File, ctx: ToolContext): Promise<void> {
  let raw: string;
  try {
    raw = await file.text();
  } catch (err) {
    toastError('Could not read file', { description: errorMessage(err) });
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    toastError('Could not import panel JSON', { description: 'File is not valid JSON.' });
    return;
  }

  const result = tryParsePanelConfig(parsed);
  if (!result.ok) {
    toastError('Could not import panel JSON', { description: result.reason });
    return;
  }

  const confirmed = await confirmDialog({
    title: 'Replace current panel?',
    message: 'This replaces the current panel with the imported one. This cannot be undone.',
    confirmLabel: 'Replace',
    danger: true,
  });
  if (!confirmed) return;

  replaceDoc(result.doc, ctx);
  toastSuccess('Panel imported');
}

// Programmatic file-picker entry point (issue #76): the header's "Import
// JSON" button owns a persistent hidden <input> via a ref, but the command
// registry's palette-facing command has no component-owned DOM node to reach
// for. A transient file input (same throwaway-input technique as
// add-actions/add-image.ts) opens the native picker and routes the result
// through the exact same importJsonFile() path as the header button and the
// drop handler.
export function pickImportJsonFile(ctx: ToolContext): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) void importJsonFile(file, ctx);
  });
  input.click();
}

// Entry point for a dropped (or picked) file of unknown kind: image/SVG ->
// routeImportFile() (#141) classifies it and either adds a raster layer or
// opens the SVG import dialog; .json -> the parse-confirm-replace path
// above; anything else -> an error toast so an unsupported drop isn't a
// silent no-op.
export function importDroppedFile(file: File, ctx: ToolContext): Promise<void> {
  if (isImportableImageFile(file)) {
    return routeImportFile(file, ctx).catch((err) => {
      toastError('Could not import image', { description: errorMessage(err) });
    });
  }
  if (isJsonFile(file)) {
    return importJsonFile(file, ctx);
  }
  toastError('Unsupported file', { description: 'Drop an image or a zpd panel JSON file.' });
  return Promise.resolve();
}
