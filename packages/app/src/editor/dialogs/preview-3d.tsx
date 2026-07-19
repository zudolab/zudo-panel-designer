import { useMemo } from 'react';
import { registerDialog } from '../registry/dialogs';
import { PREVIEW_PANEL_THICKNESS_MM, PreviewShell } from '../preview/preview-shell';
import type { PreviewViewerLoader } from '../preview/viewer-types';
import type { DialogProps } from '../types';

export interface Preview3DDialogProps {
  /** Test/integration seam; production uses the eager-safe dynamic shim. */
  readonly loadViewer?: PreviewViewerLoader;
}

export function Preview3DDialog({ props, close, ctx }: DialogProps<Preview3DDialogProps>) {
  const dimensions = useMemo(
    () => ({
      widthMm: ctx.panel.widthMm,
      heightMm: ctx.panel.heightMm,
      thicknessMm: PREVIEW_PANEL_THICKNESS_MM,
    }),
    [ctx.panel.heightMm, ctx.panel.widthMm],
  );

  return (
    <PreviewShell
      doc={ctx.doc}
      dimensions={dimensions}
      close={close}
      loadViewer={props.loadViewer}
    />
  );
}

registerDialog<Preview3DDialogProps>({
  id: 'preview-3d',
  component: Preview3DDialog,
  labelledBy: 'preview-3d-title',
});
