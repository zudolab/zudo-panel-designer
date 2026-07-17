// Document-level drag-and-drop import (#75): drop an image (raster/SVG) or a
// zpd panel JSON file anywhere on the page — not just a precise canvas
// target. Ports the shape of pgen's drop-anywhere-provider.tsx.
//
// Listens on `document` (not just the canvas) and filters every drag event
// to `dataTransfer.types.includes('Files')` so a non-file drag (e.g. text
// selected inside the app) never shows the overlay or preempts the browser's
// own drag behavior. The dragenter/dragleave pair is enter-count BALANCED:
// entering a nested child element fires its own dragenter before the parent's
// dragleave, so a naive show-on-enter/hide-on-leave toggle flickers the
// overlay off and on as the cursor crosses child boundaries while still
// inside the page. Counting nested enters and only hiding at 0 fixes that.
//
// Coordination (#75 spec): this file owns FILE DROP only. Paste handling
// (including image paste) belongs to a sibling sub-issue — no paste
// listeners here.
import { useEffect, useRef, useState } from 'react';
import { importDroppedFile } from '../import';
import type { ToolContext } from '../types';
import { Z_INDEX } from '../z-index';
import { OverlayPortal } from './overlay-portal';

function hasFileDrag(e: DragEvent): boolean {
  return e.dataTransfer?.types.includes('Files') ?? false;
}

export function DropImport({ ctx }: { ctx: ToolContext }) {
  const [isDragging, setIsDragging] = useState(false);
  const enterCountRef = useRef(0);
  // Live ref so the document listeners (registered once) always dispatch
  // against the latest ctx without re-subscribing on every render. Synced in
  // its own effect (not during render) — see Editor.tsx's docRef for the
  // same pattern.
  const ctxRef = useRef(ctx);
  useEffect(() => {
    ctxRef.current = ctx;
  });

  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      if (!hasFileDrag(e)) return;
      e.preventDefault();
      enterCountRef.current += 1;
      if (enterCountRef.current === 1) setIsDragging(true);
    };

    const handleDragOver = (e: DragEvent) => {
      if (!hasFileDrag(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };

    const handleDragLeave = (e: DragEvent) => {
      if (!hasFileDrag(e)) return;
      if (e.relatedTarget === null) {
        // Cursor exited the browser window entirely — reset immediately
        // rather than waiting for a leave/enter pair that will never come.
        enterCountRef.current = 0;
        setIsDragging(false);
        return;
      }
      // Normal leave: balance the dragenter counter.
      enterCountRef.current -= 1;
      if (enterCountRef.current <= 0) {
        enterCountRef.current = 0;
        setIsDragging(false);
      }
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      enterCountRef.current = 0;
      setIsDragging(false);

      const files = e.dataTransfer ? Array.from(e.dataTransfer.files) : [];
      const [file] = files;
      // Only the first dropped file is imported (#75) — mirrors the
      // clipboard-paste and add-image single-file behavior, avoiding history
      // interleaving from concurrent async reads.
      if (!file) return;
      void importDroppedFile(file, ctxRef.current);
    };

    document.addEventListener('dragenter', handleDragEnter);
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('dragleave', handleDragLeave);
    document.addEventListener('drop', handleDrop);
    return () => {
      document.removeEventListener('dragenter', handleDragEnter);
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('dragleave', handleDragLeave);
      document.removeEventListener('drop', handleDrop);
    };
  }, []);

  if (!isDragging) return null;

  return (
    <OverlayPortal>
      <div
        className="pointer-events-none fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm"
        style={{ zIndex: Z_INDEX.modal }}
        aria-hidden="true"
      >
        <div className="rounded-xl border-2 border-dashed border-amber-500 bg-neutral-900/80 px-8 py-6">
          <span className="text-lg font-semibold text-neutral-100">Drop image or panel JSON</span>
        </div>
      </div>
    </OverlayPortal>
  );
}
