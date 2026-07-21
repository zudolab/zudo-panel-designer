// Adds a design-time reference image via a transient file picker. Routed
// through the shared routeImportFile() (#141, see ../svg-import/
// route-import-file.ts) — same classify-then-dispatch path as the
// clipboard-paste and drop-import subs: a raster image appends a layer
// directly (via ../import-image.ts), a real SVG opens the import dialog.
import { registerAddAction } from '../registry/add-actions';
import { routeImportFile } from '../svg-import/route-import-file';

registerAddAction({
  id: 'add-image',
  label: 'Add image…',
  icon: '🖼',
  run(ctx) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.svg,image/svg+xml';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      // routeImportFile rejects only when the raster import itself fails
      // (unreadable/undecodable file) — catch here so a corrupt/mislabeled
      // image logs instead of surfacing as an unhandled promise rejection
      // (the pre-extraction handler had no error path either, so this stays
      // a no-op layer-wise, just observable).
      if (file) routeImportFile(file, ctx).catch((err) => console.error('add-image:', err));
    });
    input.click();
  },
});
