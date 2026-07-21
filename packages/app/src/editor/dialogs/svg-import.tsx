// Wave 3 (#142) of the SVG Vector Import epic (#137). Registers as
// 'svg-import'; opened by routeImportFile() (#141, ../svg-import/
// route-import-file.ts) with the fixed contract { fileName, svgText } once a
// dropped/picked/pasted file classifies as SVG.
//
// This dialog owns the analyzer -> builder -> preview pipeline end to end:
// - analyzeSvg() (#139) runs once against the SVG text.
// - Vector import is offered only when analysis is ok AND a TRIAL
//   buildPathLayers() call (#140, seeded mappings, a deterministic preview id
//   factory) also succeeds — a builder fatal (layer cap, zero shapes) lands
//   in the exact same fallback UI as an analysis fatal.
// - The preview renders the trial build's PathLayers on a <canvas> via core's
//   buildPath2D/PALETTE, NEVER mounted SVG markup. This is the security
//   property of the whole feature: what's previewed is what gets imported,
//   by construction (contrast trace.tsx, which previews via an <img
//   data:image/svg+xml…> because there is no such equivalence to preserve
//   there).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { buildPath2D, mintId, PALETTE, pathBbox, type ColorIndex, type PathLayer } from '@zpd/core';
import { registerDialog } from '../registry/dialogs';
import { toastError, toastSuccess } from '../registry/toasts';
import { importImageFile } from '../import-image';
import { analyzeSvg } from '../svg-import/analyze-svg';
import { buildPathLayers, type BuildPathLayersResult } from '../svg-import/build-path-layers';
import type { SvgImportDiagnostic } from '../svg-import/types';
import type { DialogProps } from '../types';

interface SvgImportDialogProps {
  fileName: string;
  svgText: string;
}

const SVG_IMPORT_DIALOG_TITLE_ID = 'svg-import-dialog-title';

// Diagnostics list is capped for display — a hostile/degenerate SVG could in
// principle carry hundreds of warnings, and this dialog is not the place to
// scroll through them all.
const MAX_DIAGNOSTICS_SHOWN = 20;

const PREVIEW_SIZE = 224; // px — matches trace.tsx's h-56/w-56 preview box
const PREVIEW_PADDING = 12; // px
const PREVIEW_BG = '#1c1c1c'; // neutral, distinct from any palette color

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// A fresh counter-based id factory per trial build — re-renders (a mapping
// tweak) don't burn ids from core's global mintId. See
// BuildPathLayersOptions.makeId in build-path-layers.ts.
function counterIdFactory(): (prefix: string) => string {
  let n = 0;
  return (prefix: string) => `${prefix}-preview-${(n += 1)}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

// Seeds a color-mapping row to the closest of the 3 fixed palette colors by
// plain RGB distance -- there is no perceptual-color dependency worth adding
// for a one-time seed the user can freely override via the <select>.
export function nearestPaletteIndex(hex: string, paletteHexes: readonly string[]): ColorIndex {
  const [r, g, b] = hexToRgb(hex);
  let bestIndex = 0;
  let bestDist = Infinity;
  paletteHexes.forEach((candidate, index) => {
    const [cr, cg, cb] = hexToRgb(candidate);
    const dist = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      bestIndex = index;
    }
  });
  return bestIndex as ColorIndex;
}

function seedMappings(sourceColors: string[]): Record<string, ColorIndex> {
  const paletteHexes = PALETTE.map((entry) => entry.hex);
  const mappings: Record<string, ColorIndex> = {};
  for (const hex of sourceColors) {
    mappings[hex] = nearestPaletteIndex(hex, paletteHexes);
  }
  return mappings;
}

// Draws the trial build's layers into the preview canvas, scaled to fit.
// Mirrors renderer.ts's 'path' case (fill evenodd + stroke) rather than
// reinventing it. Returns silently (no-op) when the context is unavailable —
// jsdom has no real 2D context, see the guard test below.
function drawPreview(canvas: HTMLCanvasElement, layers: PathLayer[]): void {
  const context = canvas.getContext('2d');
  if (!context) return;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = PREVIEW_BG;
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (layers.length === 0) return;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const layer of layers) {
    const box = pathBbox(layer.points, layer.extraSubpaths);
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  const bboxWidth = maxX - minX;
  const bboxHeight = maxY - minY;
  if (!(bboxWidth > 0) || !(bboxHeight > 0)) return;

  const availW = canvas.width - PREVIEW_PADDING * 2;
  const availH = canvas.height - PREVIEW_PADDING * 2;
  const scale = Math.min(availW / bboxWidth, availH / bboxHeight);
  const offsetX = PREVIEW_PADDING + (availW - bboxWidth * scale) / 2 - minX * scale;
  const offsetY = PREVIEW_PADDING + (availH - bboxHeight * scale) / 2 - minY * scale;

  context.save();
  context.translate(offsetX, offsetY);
  context.scale(scale, scale);
  for (const layer of layers) {
    const path = buildPath2D(layer.points, layer.closed, layer.extraSubpaths);
    if (!path) continue;
    if (layer.fill !== null && layer.closed) {
      context.fillStyle = PALETTE[layer.fill].hex;
      context.fill(path, 'evenodd'); // holes/islands stay holes, same as renderer.ts
    }
    if (layer.stroke !== null && layer.strokeWidth > 0) {
      context.strokeStyle = PALETTE[layer.stroke].hex;
      context.lineWidth = layer.strokeWidth;
      context.stroke(path);
    }
  }
  context.restore();
}

function SvgImportDialog({ props, close, ctx }: DialogProps<SvgImportDialogProps>) {
  // Run once per dialog open — props.svgText never changes across this
  // dialog's lifetime (a replacement dialog is a fresh mount).
  const analysis = useMemo(() => analyzeSvg(props.svgText), [props.svgText]);

  const [mappings, setMappings] = useState<Record<string, ColorIndex>>(() =>
    seedMappings(analysis.sourceColors),
  );

  const cancelRef = useRef<HTMLButtonElement>(null);
  // Explicit focus, same technique as confirm-dialog.tsx: this layout effect
  // (child) runs before DialogHost's generic "focus first focusable"
  // fallback (parent), so it wins regardless of DOM order — the color-
  // mapping <select> rows sit ahead of the actions in the layout.
  useLayoutEffect(() => {
    cancelRef.current?.focus();
  }, []);

  // The trial build: same inputs the real import will use except for the id
  // factory, re-run on every mapping edit so the verdict/preview/gating stay
  // live. buildPathLayers is pure and cheap (no DOM/canvas access), safe to
  // call on every keystroke's worth of state change.
  const trialResult: BuildPathLayersResult | null = useMemo(() => {
    if (analysis.status !== 'ok') return null;
    return buildPathLayers(analysis, {
      panelWidthMm: ctx.panel.widthMm,
      panelHeightMm: ctx.panel.heightMm,
      colorMappings: mappings,
      makeId: counterIdFactory(),
    });
  }, [analysis, mappings, ctx.panel.widthMm, ctx.panel.heightMm]);

  const vectorAvailable = analysis.status === 'ok' && trialResult !== null && trialResult.ok;

  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const layers = trialResult && trialResult.ok ? trialResult.layers : [];
    drawPreview(canvas, layers);
  }, [trialResult]);

  const firstFatal: SvgImportDiagnostic | undefined =
    analysis.status !== 'ok'
      ? analysis.diagnostics.find((d) => d.level === 'fatal')
      : trialResult && !trialResult.ok
        ? trialResult.fatal
        : undefined;

  // Builder fatals (e.g. the layer cap) aren't part of analysis.diagnostics —
  // fold it in here so the diagnostics panel is complete for that state too.
  const diagnosticList: SvgImportDiagnostic[] =
    trialResult && !trialResult.ok
      ? [...analysis.diagnostics, trialResult.fatal]
      : analysis.diagnostics;

  const layerCount = trialResult && trialResult.ok ? trialResult.layers.length : null;

  const importVector = () => {
    if (analysis.status !== 'ok' || !trialResult || !trialResult.ok) return;
    const result = buildPathLayers(analysis, {
      panelWidthMm: ctx.panel.widthMm,
      panelHeightMm: ctx.panel.heightMm,
      colorMappings: mappings,
      makeId: mintId,
    });
    // The trial build above already proved these exact inputs succeed; this
    // only defends against buildPathLayers somehow disagreeing with itself.
    if (!result.ok) return;
    // One commit = one undo entry, same atomic pattern as trace.tsx:83-103.
    ctx.commit({ ...ctx.doc, layers: [...ctx.doc.layers, ...result.layers] });
    ctx.selectIds(result.layers.map((layer) => layer.id));
    toastSuccess(`Imported ${result.layers.length} shape${result.layers.length === 1 ? '' : 's'}`);
    close();
  };

  const importAsImageInstead = () => {
    const file = new File([props.svgText], props.fileName, { type: 'image/svg+xml' });
    importImageFile(file, ctx).catch((err: unknown) => {
      toastError('Could not import image', { description: errorMessage(err) });
    });
    close();
  };

  return (
    <div className="w-[min(40rem,90vw)]">
      <h2 id={SVG_IMPORT_DIALOG_TITLE_ID} className="mb-1 text-sm font-semibold text-neutral-100">
        Import SVG
      </h2>
      <p className="mb-3 truncate text-xs text-neutral-500">{props.fileName}</p>

      {vectorAvailable ? (
        <p className="mb-3 text-xs text-emerald-400">{layerCount} editable shapes</p>
      ) : (
        <p className="mb-3 text-xs text-amber-400">
          {firstFatal?.message ?? 'This SVG could not be converted to vectors.'} — import as an
          image instead.
        </p>
      )}

      <div className="mb-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="text-neutral-500">Viewport</div>
          <div className="text-neutral-200">
            {analysis.viewport.width} × {analysis.viewport.height}
          </div>
        </div>
        <div>
          <div className="text-neutral-500">Shapes</div>
          <div className="text-neutral-200">{analysis.shapes.length}</div>
        </div>
        <div>
          <div className="text-neutral-500">Layers</div>
          <div className="text-neutral-200">{layerCount ?? '—'}</div>
        </div>
      </div>

      {diagnosticList.length > 0 && (
        <details className="mb-3 text-xs text-neutral-400">
          <summary className="cursor-pointer select-none">
            Diagnostics ({diagnosticList.length})
          </summary>
          <ul className="mt-1 flex flex-col gap-0.5 pl-3">
            {diagnosticList.slice(0, MAX_DIAGNOSTICS_SHOWN).map((d, i) => (
              <li key={i} className={d.level === 'fatal' ? 'text-amber-400' : 'text-neutral-400'}>
                {d.code}: {d.message}
              </li>
            ))}
          </ul>
          {diagnosticList.length > MAX_DIAGNOSTICS_SHOWN && (
            <p className="mt-1 pl-3 text-neutral-500">
              +{diagnosticList.length - MAX_DIAGNOSTICS_SHOWN} more
            </p>
          )}
        </details>
      )}

      {vectorAvailable && (
        <div className="flex gap-4">
          <div className="flex flex-1 flex-col gap-1.5">
            {analysis.sourceColors.map((hex) => (
              <div key={hex} className="flex items-center gap-2 text-xs">
                <span
                  className="h-4 w-4 shrink-0 rounded border border-neutral-600"
                  style={{ background: hex }}
                />
                <span className="flex-1 text-neutral-300">{hex}</span>
                <select
                  aria-label={`color for ${hex}`}
                  value={mappings[hex]}
                  onChange={(e) =>
                    setMappings({
                      ...mappings,
                      [hex]: Number(e.target.value) as ColorIndex,
                    })
                  }
                  className="rounded border border-neutral-600 bg-neutral-800 px-1 py-0.5 text-xs text-neutral-100"
                >
                  {PALETTE.map((entry) => (
                    <option key={entry.index} value={entry.index}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div className="flex h-56 w-56 shrink-0 items-center justify-center overflow-hidden rounded border border-neutral-700 bg-neutral-950">
            <canvas ref={previewCanvasRef} width={PREVIEW_SIZE} height={PREVIEW_SIZE} />
          </div>
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          ref={cancelRef}
          type="button"
          onClick={close}
          className="rounded border border-neutral-600 bg-neutral-700 px-3 py-1 text-xs text-neutral-100 hover:bg-neutral-600"
        >
          Cancel
        </button>
        {!vectorAvailable && (
          <button
            type="button"
            onClick={importAsImageInstead}
            className="rounded border border-neutral-600 bg-neutral-700 px-3 py-1 text-xs text-neutral-100 hover:bg-neutral-600"
          >
            Import as image instead
          </button>
        )}
        {vectorAvailable && (
          <button
            type="button"
            onClick={importVector}
            className="rounded border border-sky-500 bg-sky-600 px-3 py-1 text-xs text-white hover:bg-sky-500"
          >
            Import {layerCount} shape{layerCount === 1 ? '' : 's'}
          </button>
        )}
      </div>
    </div>
  );
}

registerDialog<SvgImportDialogProps>({
  id: 'svg-import',
  component: SvgImportDialog,
  labelledBy: SVG_IMPORT_DIALOG_TITLE_ID,
});
