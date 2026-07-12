// Wave 5 (#11) image -> vector dialog. Registers as 'trace'; opened by the
// image inspector's "Convert to vector…" button via
// ctx.openDialog('trace', { layerId }) — see inspectors/image.tsx.
//
// The preview renders the traced SVG through an <img data:image/svg+xml…>,
// never dangerouslySetInnerHTML/innerHTML: an <img> decodes SVG in "image
// mode", which never executes embedded scripts, so a hostile trace result
// (or a hostile source image feeding the tracer) can't run script in the app.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ImageLayer } from '@zpd/core';
import { registerDialog } from '../registry/dialogs';
import { Field } from '../components/inspector-ui';
import type { DialogProps } from '../types';
import {
  DEFAULT_TRACE_OPTIONS,
  imageToImageData,
  traceToSvg,
  type TraceOptions,
} from '../trace-pipeline';
import { svgToPathLayers } from '../svg-to-path-layers';

interface TraceDialogProps {
  layerId: string;
}

function TraceDialog({ props, close, ctx }: DialogProps<TraceDialogProps>) {
  const layer = ctx.doc.layers.find(
    (l): l is ImageLayer => l.id === props.layerId && l.type === 'image',
  );

  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [options, setOptions] = useState<TraceOptions>(DEFAULT_TRACE_OPTIONS);
  const [svg, setSvg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The renderer's <img> cache is Editor-local (Editor.tsx's imagesRef), so
  // the dialog decodes its own copy from the layer's dataURL — no source
  // layer's src ever needs a network fetch, only Image() decode. `layer` is
  // the same object reference across re-renders unless ctx.doc.layers is
  // actually replaced (find() over an unchanged array), so this only
  // re-decodes on a real doc change, not on every TraceDialog re-render.
  useEffect(() => {
    if (!layer) return;
    const img = new Image();
    img.onload = () => setImage(img);
    img.onerror = () => setError('could not decode image');
    img.src = layer.src;
  }, [layer]);

  // jsdom has no real <canvas> 2D context (see trace-pipeline.ts), so this
  // throws in tests — caught here rather than crashing the dialog.
  const imageData = useMemo(() => {
    if (!image) return null;
    try {
      return imageToImageData(image);
    } catch {
      return null;
    }
  }, [image]);

  useEffect(() => {
    if (!imageData) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setBusy(true);
      setError(null);
      traceToSvg(imageData, options)
        .then((result) => setSvg(result))
        .catch((e: unknown) => setError(String(e)))
        .finally(() => setBusy(false));
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [imageData, options]);

  const previewSrc = svg ? `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` : null;

  const apply = () => {
    if (!layer || !svg) return;
    const traced = svgToPathLayers(svg, {
      x: layer.x,
      y: layer.y,
      width: layer.width,
      height: layer.height,
    });
    if (traced.length === 0) return;
    const index = ctx.doc.layers.findIndex((l) => l.id === layer.id);
    const before = ctx.doc.layers.slice(0, index);
    const after = ctx.doc.layers.slice(index + 1);
    // one commit = one undo entry: hide the source raster, insert the traced
    // vectors directly above it, select the first one
    ctx.commit({
      ...ctx.doc,
      layers: [...before, { ...layer, hidden: true }, ...traced, ...after],
    });
    ctx.select(traced[0].id);
    close();
  };

  if (!layer) {
    return (
      <div className="w-[min(20rem,90vw)]">
        <p className="text-xs text-neutral-400">This image layer no longer exists.</p>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={close}
            className="rounded border border-neutral-600 bg-neutral-700 px-3 py-1 text-xs text-neutral-100 hover:bg-neutral-600"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-[min(36rem,90vw)]">
      <h2 className="mb-3 text-sm font-semibold text-neutral-100">Convert image to vectors</h2>
      <div className="flex gap-4">
        <div className="flex h-56 w-56 shrink-0 items-center justify-center overflow-hidden rounded border border-neutral-700 bg-neutral-950">
          {previewSrc ? (
            <img src={previewSrc} alt="trace preview" className="max-h-full max-w-full" />
          ) : (
            <span className="px-3 text-center text-[11px] text-neutral-500">
              {error ?? 'tracing…'}
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col justify-between gap-2">
          <div className="flex flex-col gap-2">
            <Field label="3-color palette">
              <input
                type="checkbox"
                checked={options.usePalette}
                onChange={(e) => setOptions({ ...options, usePalette: e.target.checked })}
              />
            </Field>
            {!options.usePalette && (
              <Field label={`colors: ${options.numberOfColors}`}>
                <input
                  type="range"
                  min={2}
                  max={8}
                  step={1}
                  value={options.numberOfColors}
                  onChange={(e) => setOptions({ ...options, numberOfColors: Number(e.target.value) })}
                  className="w-full"
                />
              </Field>
            )}
            <Field label={`min shape: ${options.minShapeOutline}`}>
              <input
                type="range"
                min={0}
                max={60}
                step={2}
                value={options.minShapeOutline}
                onChange={(e) => setOptions({ ...options, minShapeOutline: Number(e.target.value) })}
                className="w-full"
              />
            </Field>
            <Field label={`blur: ${options.blurRadius}`}>
              <input
                type="range"
                min={0}
                max={5}
                step={1}
                value={options.blurRadius}
                onChange={(e) => setOptions({ ...options, blurRadius: Number(e.target.value) })}
                className="w-full"
              />
            </Field>
          </div>
          <p className="text-[11px] text-neutral-500">
            Traced vectors are mapped to the 3 panel colors. The source image stays as a hidden
            design reference — only vector layers are manufacturable.
          </p>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={close}
          className="rounded border border-neutral-600 bg-neutral-700 px-3 py-1 text-xs text-neutral-100 hover:bg-neutral-600"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={apply}
          disabled={!svg || busy}
          className="rounded border border-sky-500 bg-sky-600 px-3 py-1 text-xs text-white hover:bg-sky-500 disabled:cursor-default disabled:opacity-40"
        >
          Apply
        </button>
      </div>
    </div>
  );
}

registerDialog({ id: 'trace', component: TraceDialog });
