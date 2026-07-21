// Single shared routing function for every SVG/image entry point (#141):
// drop (../import.ts), the picker (../add-actions/add-image.ts), and
// clipboard paste (../use-clipboard.ts) all call routeImportFile() instead
// of deciding svg-vs-raster themselves, preserving the "exact same code
// path" property (#75) for the image-ish half of import as well as the JSON
// half. classifyImportFile (#138) does the byte/name/MIME sniffing; this
// module only decides what happens for each ImportFileKind.
//
// importImageFile's rejection is deliberately left to propagate (not
// caught here) -- each entry point already has its own failure UX (import.ts
// toasts, add-image.ts/use-clipboard.ts console.error), and this router
// would otherwise have to pick one for all three.
import { classifyImportFile } from './classify-file';
import { importImageFile } from '../import-image';
import { toastError, toastWarning } from '../registry/toasts';
import type { ToolContext } from '../types';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const SVG_EXTENSION = /\.svg$/i;

export async function routeImportFile(file: File, ctx: ToolContext): Promise<void> {
  const kind = await classifyImportFile(file);

  switch (kind) {
    case 'svg': {
      let svgText: string;
      try {
        svgText = await file.text();
      } catch (err) {
        toastError('Could not read file', { description: errorMessage(err) });
        return;
      }
      // Clipboard-pasted files can arrive with an empty name (#141 spec) --
      // the dialog still needs something to display/save as.
      ctx.openDialog('svg-import', { fileName: file.name || 'clipboard.svg', svgText });
      return;
    }

    case 'raster': {
      await importImageFile(file, ctx);
      // A .svg-named file whose bytes turned out to be raster (classify-file's
      // magic-byte check wins over the misleading extension) -- imported fine,
      // but worth telling the user their file wasn't actually a vector.
      if (SVG_EXTENSION.test(file.name)) {
        toastWarning('Raster content in .svg file — imported as image.');
      }
      return;
    }

    case 'svg-oversize': {
      // Preserves today's behavior for large SVGs (no regression): imported
      // as a raster layer rather than run through the vector pipeline.
      await importImageFile(file, ctx);
      toastWarning('SVG too large to convert to vectors — imported as image.');
      return;
    }

    case 'other':
      toastError('Unsupported file', { description: 'Drop an image or a zpd panel JSON file.' });
      return;
  }
}
