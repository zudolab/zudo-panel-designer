// Adds a design-time reference image (raster) via a transient file picker. The
// Editor's asset-loading effect is what actually decodes/caches the <img> from
// the layer's src, so this handler only needs to append the layer — done by
// the shared importImageFile() (see ../import-image.ts), which also backs the
// clipboard-paste and drop-import subs.
import { registerAddAction } from '../registry/add-actions';
import { importImageFile } from '../import-image';

registerAddAction({
  id: 'add-image',
  label: 'Add image…',
  icon: '🖼',
  run(ctx) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      // importImageFile rejects on an unreadable/undecodable file — catch
      // here so a corrupt/mislabeled image logs instead of surfacing as an
      // unhandled promise rejection (the pre-extraction handler had no error
      // path either, so this stays a no-op layer-wise, just observable).
      if (file) importImageFile(file, ctx).catch((err) => console.error('add-image:', err));
    });
    input.click();
  },
});
