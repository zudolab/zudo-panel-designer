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
      if (file) void importImageFile(file, ctx);
    });
    input.click();
  },
});
