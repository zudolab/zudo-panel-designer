// Shared file-import dispatch (#75): both the document-level drop handler
// (components/drop-import.tsx) and the header's "Import JSON" button route
// through this module so a file dropped or picked takes the exact same path
// — an image/SVG becomes a layer via importImageFile(); a .json file is
// validated with core's STRICT tryParsePanelConfig (not the lenient
// parsePanelConfig, which would silently accept `{}` as an empty document)
// and, only after the user confirms, replaces the whole document.
import { tryParsePanelConfig } from '@zpd/core';
import { confirmDialog } from './components/confirm-dialog';
import { importImageFile } from './import-image';
import { replaceDoc } from './replace-doc';
import { toastError, toastSuccess } from './registry/toasts';
import type { ToolContext } from './types';

export function isImportableImageFile(file: File): boolean {
  return file.type.startsWith('image/') || file.name.toLowerCase().endsWith('.svg');
}

function isJsonFile(file: File): boolean {
  return file.type === 'application/json' || file.name.toLowerCase().endsWith('.json');
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

// Entry point for a dropped (or picked) file of unknown kind: image/SVG ->
// add as a layer; .json -> the parse-confirm-replace path above; anything
// else -> an error toast so an unsupported drop isn't a silent no-op.
export function importDroppedFile(file: File, ctx: ToolContext): Promise<void> {
  if (isImportableImageFile(file)) {
    return importImageFile(file, ctx).catch((err) => {
      toastError('Could not import image', { description: errorMessage(err) });
    });
  }
  if (isJsonFile(file)) {
    return importJsonFile(file, ctx);
  }
  toastError('Unsupported file', { description: 'Drop an image or a zpd panel JSON file.' });
  return Promise.resolve();
}
