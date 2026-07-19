import { useMemo } from 'react';
import { PANEL_THICKNESS_MM } from '@zpd/core';
import { registerDialog } from '../registry/dialogs';
import { PreviewShell, type PersistPreviewDocument } from '../preview/preview-shell';
import type { PreviewViewerLoader } from '../preview/viewer-types';
import type { DialogProps } from '../types';

export interface Preview3DDialogProps {
  /** Test/integration seam; production uses the eager-safe dynamic shim. */
  readonly loadViewer?: PreviewViewerLoader;
  /** Test seam; production performs a real full-page reload. */
  readonly reloadPage?: () => void;
  /** Test seam; production synchronously persists the current panel before reload. */
  readonly persistDoc?: PersistPreviewDocument;
}

export function Preview3DDialog({ props, close, ctx }: DialogProps<Preview3DDialogProps>) {
  const dimensions = useMemo(
    () => ({
      widthMm: ctx.panel.widthMm,
      heightMm: ctx.panel.heightMm,
      thicknessMm: PANEL_THICKNESS_MM,
    }),
    [ctx.panel.heightMm, ctx.panel.widthMm],
  );

  return (
    <PreviewShell
      doc={ctx.doc}
      dimensions={dimensions}
      close={close}
      loadViewer={props.loadViewer}
      persistDoc={props.persistDoc}
      reloadPage={props.reloadPage}
    />
  );
}

registerDialog<Preview3DDialogProps>({
  id: 'preview-3d',
  component: Preview3DDialog,
  labelledBy: 'preview-3d-title',
});
