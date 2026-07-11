import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_TRACE_OPTIONS,
  imageToImageData,
  svgToPathLayers,
  traceToSvg,
  type TraceOptions,
} from '../trace';
import type { ImageLayer, PathLayer } from '../types';

export function TraceDialog({
  layer,
  image,
  onApply,
  onClose,
}: {
  layer: ImageLayer;
  image: HTMLImageElement;
  onApply: (pathLayers: PathLayer[]) => void;
  onClose: () => void;
}) {
  const [options, setOptions] = useState<TraceOptions>(DEFAULT_TRACE_OPTIONS);
  const [svg, setSvg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const imageData = useMemo(() => {
    try {
      return imageToImageData(image);
    } catch {
      return null;
    }
  }, [image]);

  useEffect(() => {
    if (!imageData) {
      setError('image is not loaded yet');
      return;
    }
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
    if (!svg) return;
    const layers = svgToPathLayers(svg, {
      x: layer.x,
      y: layer.y,
      width: layer.width,
      height: layer.height,
    });
    onApply(layers);
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog dialog-wide" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>Convert image to vectors</h2>
          <button onClick={onClose}>✕</button>
        </div>
        <div className="trace-body">
          <div className="trace-preview">
            {previewSrc ? (
              <img src={previewSrc} alt="trace preview" />
            ) : (
              <div className="trace-placeholder">{error ?? 'tracing…'}</div>
            )}
            {busy && <div className="trace-busy">tracing…</div>}
          </div>
          <div className="trace-controls">
            <label className="row">
              <span>3-color palette</span>
              <input
                type="checkbox"
                checked={options.usePalette}
                onChange={(e) => setOptions({ ...options, usePalette: e.target.checked })}
              />
            </label>
            {!options.usePalette && (
              <label className="row">
                <span>Colors: {options.numberOfColors}</span>
                <input
                  type="range"
                  min={2}
                  max={8}
                  step={1}
                  value={options.numberOfColors}
                  onChange={(e) =>
                    setOptions({ ...options, numberOfColors: Number(e.target.value) })
                  }
                />
              </label>
            )}
            <label className="row">
              <span>Min shape: {options.minShapeOutline}</span>
              <input
                type="range"
                min={0}
                max={60}
                step={2}
                value={options.minShapeOutline}
                onChange={(e) => setOptions({ ...options, minShapeOutline: Number(e.target.value) })}
              />
            </label>
            <label className="row">
              <span>Blur: {options.blurRadius}</span>
              <input
                type="range"
                min={0}
                max={5}
                step={1}
                value={options.blurRadius}
                onChange={(e) => setOptions({ ...options, blurRadius: Number(e.target.value) })}
              />
            </label>
            <p className="trace-note">
              Traced vectors are mapped to the 3 panel colors. The source image stays as a hidden
              design reference — only vector layers are manufacturable.
            </p>
            <button className="primary" onClick={apply} disabled={!svg || busy}>
              Expand to vector layers
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
