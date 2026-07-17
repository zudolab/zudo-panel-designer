// The mm ruler strips + corner box framing the canvas viewport. The strips are
// FIXED in layout — they never receive pan/zoom-derived offsets or transforms;
// only the canvas CONTENT repaints on camera change. (Scroll/pan-synced strip
// positioning is a proven drift-bug source — see issue #33.)
//
// All tick placement math lives in ../ruler-ticks (pure + unit-tested); this
// file only paints.
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { Camera } from '../camera';
import { formatTickLabel, getRulerTicksMm, pickTickStepMm } from '../ruler-ticks';

export const RULER_THICKNESS_PX = 20;

// Hardcoded dark theme (the app has no CSS token system): tailwind neutral-900
// bg, neutral-500 ticks/labels, neutral-800 border — matching the editor chrome.
const RULER_BG = '#171717';
const RULER_FG = '#737373';
const RULER_BORDER = '#262626';
const MAJOR_TICK_PX = RULER_THICKNESS_PX * 0.6;
const MINOR_TICK_PX = RULER_THICKNESS_PX * 0.3;
const LABEL_FONT = '10px sans-serif';
const LABEL_PAD_PX = 2;

export function RulerCorner() {
  return (
    <div
      data-testid="ruler-corner"
      className="flex select-none items-center justify-center border-b border-r border-neutral-800 bg-neutral-900 text-[10px] text-neutral-500"
    >
      mm
    </div>
  );
}

export interface RulerStripProps {
  orientation: 'horizontal' | 'vertical';
  camera: Camera | null;
  /** css px length along the strip's long axis (= viewport width / height) */
  lengthPx: number;
  // Guide drag source (#54). A pointerdown on the strip STARTS a create drag;
  // the strip only reports the initial event — the whole cross-element drag is
  // then tracked at the window level by useGuideDrag (see its design comment).
  // The strip fixes the orientation (this is the horizontal or vertical strip);
  // the controller decides the rest.
  guidesEnabled?: boolean;
  onGuidePointerDown?: (e: ReactPointerEvent) => void;
}

export function RulerStrip({
  orientation,
  camera,
  lengthPx,
  guidesEnabled = false,
  onGuidePointerDown,
}: RulerStripProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const horizontal = orientation === 'horizontal';
  const dpr = window.devicePixelRatio || 1;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !camera || lengthPx <= 0) return;
    const cssW = horizontal ? lengthPx : RULER_THICKNESS_PX;
    const cssH = horizontal ? RULER_THICKNESS_PX : lengthPx;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr); // fresh transform: setting width/height reset the ctx

    ctx.fillStyle = RULER_BG;
    ctx.fillRect(0, 0, cssW, cssH);

    // border along the edge that meets the viewport (bottom / right)
    ctx.strokeStyle = RULER_BORDER;
    ctx.lineWidth = 1 / dpr;
    const borderPos = RULER_THICKNESS_PX - 0.5 / dpr;
    ctx.beginPath();
    if (horizontal) {
      ctx.moveTo(0, borderPos);
      ctx.lineTo(cssW, borderPos);
    } else {
      ctx.moveTo(borderPos, 0);
      ctx.lineTo(borderPos, cssH);
    }
    ctx.stroke();

    const step = pickTickStepMm(camera.pxPerMm);
    const offset = horizontal ? camera.offsetX : camera.offsetY;
    const ticks = getRulerTicksMm(camera.pxPerMm, offset, lengthPx, step);

    ctx.strokeStyle = RULER_FG;
    ctx.fillStyle = RULER_FG;
    ctx.font = LABEL_FONT;
    ctx.beginPath();
    for (const tick of ticks) {
      // snap to the physical pixel grid, then center in the pixel for a crisp
      // 1-device-px line at any dpr
      const pos = Math.round(tick.cssPx * dpr) / dpr + 0.5 / dpr;
      const len = tick.isMajor ? MAJOR_TICK_PX : MINOR_TICK_PX;
      if (horizontal) {
        ctx.moveTo(pos, RULER_THICKNESS_PX);
        ctx.lineTo(pos, RULER_THICKNESS_PX - len);
      } else {
        ctx.moveTo(RULER_THICKNESS_PX, pos);
        ctx.lineTo(RULER_THICKNESS_PX - len, pos);
      }
    }
    ctx.stroke();

    for (const tick of ticks) {
      if (!tick.isMajor) continue;
      const label = formatTickLabel(tick.mm, step.major);
      if (horizontal) {
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(label, tick.cssPx + LABEL_PAD_PX, LABEL_PAD_PX);
      } else {
        // rotate -90deg: text reads bottom-to-top alongside the tick
        ctx.save();
        ctx.translate(LABEL_PAD_PX, tick.cssPx - LABEL_PAD_PX);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
    }
  }, [camera, lengthPx, dpr, horizontal]);

  return (
    <div
      data-testid={horizontal ? 'ruler-h' : 'ruler-v'}
      className="overflow-hidden bg-neutral-900"
      style={guidesEnabled ? { cursor: horizontal ? 'row-resize' : 'col-resize' } : undefined}
      onPointerDown={guidesEnabled ? onGuidePointerDown : undefined}
    >
      <canvas ref={canvasRef} className="block" />
    </div>
  );
}
