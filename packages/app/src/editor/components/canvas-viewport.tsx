// The center canvas surface. Purely presentational: the <canvas> backing store
// is sized/painted by the Editor's effects; this only wires the container ref
// (measured by a ResizeObserver) and the pointer handlers. touch-action:none
// keeps the browser from hijacking drags as scroll/zoom gestures.
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';

export interface CanvasViewportProps {
  containerRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  cursor: string;
  onPointerDown(e: ReactPointerEvent<HTMLCanvasElement>): void;
  onPointerMove(e: ReactPointerEvent<HTMLCanvasElement>): void;
  onPointerUp(e: ReactPointerEvent<HTMLCanvasElement>): void;
  onPointerLeave(e: ReactPointerEvent<HTMLCanvasElement>): void;
  onDoubleClick(e: ReactPointerEvent<HTMLCanvasElement>): void;
}

export function CanvasViewport({
  containerRef,
  canvasRef,
  cursor,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerLeave,
  onDoubleClick,
}: CanvasViewportProps) {
  return (
    <div ref={containerRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden" style={{ cursor }}>
      <canvas
        ref={canvasRef}
        data-testid="editor-canvas"
        className="block touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onDoubleClick={onDoubleClick}
      />
    </div>
  );
}
