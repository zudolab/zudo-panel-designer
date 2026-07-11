import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  fitCamera,
  panBy,
  project,
  unproject,
  zoomAt,
  type Camera,
} from './camera';
import { PatternDialog } from './components/pattern-dialog';
import { TraceDialog } from './components/trace-dialog';
import { DEFAULT_FONT, ensureFontLoaded, GOOGLE_FONTS } from './fonts';
import { useDocHistory } from './history';
import { hitTestDoc } from './hit-test';
import { PALETTE } from './palette';
import { PANEL_HEIGHT_MM, PANEL_SIZES, panelSizeByHp } from './panel-sizes';
import { movePathAnchor, movePathHandle, translatePathLayer } from './path-geometry';
import { defaultParams, patternByName } from './patterns';
import {
  layerBbox,
  renderScene,
  resizeHandleRects,
  rotatedAabb,
  type HandleId,
} from './renderer';
import { downloadDocJson } from './serialize';
import type {
  ColorIndex,
  DocState,
  ImageLayer,
  Layer,
  PathLayer,
  PathPoint,
  PatternLayer,
  ShapeLayer,
  TextLayer,
} from './types';
import { mintId } from './types';

type Tool = 'select' | 'pan' | 'zoom' | 'pen' | 'text';

const INITIAL_DOC: DocState = {
  panelHp: 12,
  layers: [
    {
      id: mintId('pattern'),
      name: 'Dot Grid',
      type: 'pattern',
      patternType: 'dot-grid',
      color: 1,
      params: { pitch: 5, radius: 0.8 },
    },
    {
      id: mintId('shape'),
      name: 'Rect',
      type: 'shape',
      shape: 'rect',
      x: 10,
      y: 20,
      width: 40,
      height: 24,
      color: 2,
    },
  ],
};

interface PenDraft {
  points: PathPoint[];
  mouse: { x: number; y: number } | null;
}

type DragState =
  | { kind: 'pan'; startX: number; startY: number; origCam: Camera; moved: boolean }
  | { kind: 'pen-drag'; moved: boolean }
  | { kind: 'move'; layerId: string; startMm: { x: number; y: number }; orig: Layer; moved: boolean }
  | {
      kind: 'resize';
      layerId: string;
      handle: HandleId;
      orig: { x: number; y: number; width: number; height: number };
      startMm: { x: number; y: number };
      moved: boolean;
    }
  | { kind: 'anchor'; layerId: string; index: number; moved: boolean }
  | { kind: 'handle'; layerId: string; index: number; which: 'hin' | 'hout'; moved: boolean };

const snap = (v: number) => Math.round(v * 10) / 10; // 0.1mm

export function App() {
  const { doc, canUndo, canRedo, commit, replace, beginGesture, undo, redo } =
    useDocHistory(INITIAL_DOC);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [camera, setCamera] = useState<Camera | null>(null);
  const [penDraft, setPenDraft] = useState<PenDraft | null>(null);
  const [patternDialog, setPatternDialog] = useState<
    { mode: 'add' } | { mode: 'change'; layerId: string } | null
  >(null);
  const [traceLayerId, setTraceLayerId] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const [spaceDown, setSpaceDown] = useState(false);
  const [, setAssetVersion] = useState(0); // bumps when images/fonts finish loading

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef(new Map<string, HTMLImageElement>());
  const dragRef = useRef<DragState | null>(null);
  const fitScaleRef = useRef(4);

  const panel = panelSizeByHp(doc.panelHp);
  const selected = doc.layers.find((l) => l.id === selectedId) ?? null;
  const bumpAssets = useCallback(() => setAssetVersion((v) => v + 1), []);

  // --- layout / camera -------------------------------------------------
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() =>
      setCanvasSize({ w: el.clientWidth, h: el.clientHeight }),
    );
    observer.observe(el);
    setCanvasSize({ w: el.clientWidth, h: el.clientHeight });
    return () => observer.disconnect();
  }, []);

  const fitView = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const cam = fitCamera(el.clientWidth, el.clientHeight, panel.widthMm, PANEL_HEIGHT_MM);
    fitScaleRef.current = cam.pxPerMm;
    setCamera(cam);
  }, [panel.widthMm]);

  useEffect(() => {
    if (canvasSize.w > 0) fitView();
    // refit when panel size changes or on first measure
  }, [canvasSize.w > 0, doc.panelHp, fitView]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- asset loading ----------------------------------------------------
  useEffect(() => {
    for (const layer of doc.layers) {
      if (layer.type === 'image' && !imagesRef.current.has(layer.id)) {
        const img = new Image();
        img.onload = bumpAssets;
        img.src = layer.src;
        imagesRef.current.set(layer.id, img);
      }
      if (layer.type === 'text') {
        void ensureFontLoaded(layer.fontFamily).then(bumpAssets);
      }
    }
  }, [doc.layers, bumpAssets]);

  // --- rendering ---------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !camera || canvasSize.w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvasSize.w * dpr);
    canvas.height = Math.round(canvasSize.h * dpr);
    canvas.style.width = `${canvasSize.w}px`;
    canvas.style.height = `${canvasSize.h}px`;
    renderScene(canvas, doc, panel.widthMm, PANEL_HEIGHT_MM, camera, {
      selectedId,
      penDraft,
      images: imagesRef.current,
      showNodes: tool === 'select' && selected?.type === 'path',
    });
  });

  // --- wheel zoom (non-passive) ------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * 0.0015);
      setCamera((cam) =>
        cam ? zoomAt(cam, e.clientX - rect.left, e.clientY - rect.top, factor) : cam,
      );
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  // --- doc helpers --------------------------------------------------------
  const updateLayer = useCallback(
    (id: string, patch: Partial<Layer>, options: { commit: boolean }) => {
      const next: DocState = {
        ...doc,
        layers: doc.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)),
      };
      if (options.commit) commit(next);
      else replace(next);
    },
    [doc, commit, replace],
  );

  const deleteLayer = useCallback(
    (id: string) => {
      commit({ ...doc, layers: doc.layers.filter((l) => l.id !== id) });
      imagesRef.current.delete(id);
      if (selectedId === id) setSelectedId(null);
    },
    [doc, commit, selectedId],
  );

  const moveLayerInList = (id: string, dir: 1 | -1) => {
    const idx = doc.layers.findIndex((l) => l.id === id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= doc.layers.length) return;
    const layers = [...doc.layers];
    [layers[idx], layers[target]] = [layers[target], layers[idx]];
    commit({ ...doc, layers });
  };

  // --- add-layer actions ---------------------------------------------------
  const addShape = (shape: 'rect' | 'ellipse') => {
    const layer: ShapeLayer = {
      id: mintId('shape'),
      name: shape === 'rect' ? 'Rect' : 'Ellipse',
      type: 'shape',
      shape,
      x: snap(panel.widthMm / 4),
      y: snap(PANEL_HEIGHT_MM / 3),
      width: Math.min(20, snap(panel.widthMm / 2)),
      height: 16,
      color: 1,
    };
    commit({ ...doc, layers: [...doc.layers, layer] });
    setSelectedId(layer.id);
  };

  const addPattern = (patternName: string) => {
    const gen = patternByName(patternName);
    const layer: PatternLayer = {
      id: mintId('pattern'),
      name: gen.displayName,
      type: 'pattern',
      patternType: gen.name,
      color: 1,
      params: defaultParams(gen),
    };
    commit({ ...doc, layers: [...doc.layers, layer] });
    setSelectedId(layer.id);
  };

  const addImageFromFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result);
      const probe = new Image();
      probe.onload = () => {
        const maxW = panel.widthMm * 0.8;
        const maxH = PANEL_HEIGHT_MM * 0.5;
        const scale = Math.min(maxW / probe.naturalWidth, maxH / probe.naturalHeight);
        const layer: ImageLayer = {
          id: mintId('image'),
          name: file.name,
          type: 'image',
          src,
          x: snap(panel.widthMm * 0.1),
          y: snap(PANEL_HEIGHT_MM * 0.15),
          width: snap(probe.naturalWidth * scale),
          height: snap(probe.naturalHeight * scale),
        };
        imagesRef.current.set(layer.id, probe);
        commit({ ...doc, layers: [...doc.layers, layer] });
        setSelectedId(layer.id);
      };
      probe.src = src;
    };
    reader.readAsDataURL(file);
  };

  const addTextAt = (mmX: number, mmY: number) => {
    const layer: TextLayer = {
      id: mintId('text'),
      name: 'Text',
      type: 'text',
      content: 'TEXT',
      fontFamily: DEFAULT_FONT,
      sizeMm: 6,
      x: snap(mmX),
      y: snap(mmY),
      color: 2,
    };
    void ensureFontLoaded(DEFAULT_FONT).then(bumpAssets);
    commit({ ...doc, layers: [...doc.layers, layer] });
    setSelectedId(layer.id);
    setTool('select');
  };

  const commitPenDraft = useCallback(
    (closed: boolean) => {
      if (!penDraft || penDraft.points.length < 2) {
        setPenDraft(null);
        return;
      }
      const layer: PathLayer = {
        id: mintId('path'),
        name: 'Path',
        type: 'path',
        points: penDraft.points,
        closed,
        fill: closed ? 1 : null,
        stroke: closed ? null : 1,
        strokeWidth: closed ? 0 : 0.6,
      };
      commit({ ...doc, layers: [...doc.layers, layer] });
      setSelectedId(layer.id);
      setTool('select');
      setPenDraft(null);
    },
    [penDraft, doc, commit],
  );

  const applyTrace = (imageLayerId: string, pathLayers: PathLayer[]) => {
    const idx = doc.layers.findIndex((l) => l.id === imageLayerId);
    if (idx < 0) return;
    const layers = [...doc.layers];
    layers[idx] = { ...layers[idx], hidden: true } as Layer;
    layers.splice(idx + 1, 0, ...pathLayers);
    commit({ ...doc, layers });
    setTraceLayerId(null);
    setSelectedId(pathLayers[0]?.id ?? null);
  };

  // --- pointer interactions -------------------------------------------------
  const mmFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    return { px, mm: camera ? unproject(camera, px.x, px.y) : { x: 0, y: 0 } };
  };

  const ensureGesture = (drag: DragState) => {
    if (!drag.moved) {
      drag.moved = true;
      beginGesture();
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!camera) return;
    const { px, mm } = mmFromEvent(e);
    const effTool: Tool = spaceDown ? 'pan' : tool;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // synthetic pointer events (tests) have no active pointer to capture
    }

    if (effTool === 'pan') {
      dragRef.current = { kind: 'pan', startX: px.x, startY: px.y, origCam: camera, moved: false };
      return;
    }

    if (effTool === 'zoom') {
      setCamera(zoomAt(camera, px.x, px.y, e.altKey ? 1 / 1.5 : 1.5));
      return;
    }

    if (effTool === 'text') {
      addTextAt(mm.x, mm.y);
      return;
    }

    if (effTool === 'pen') {
      const draft = penDraft ?? { points: [], mouse: null };
      if (draft.points.length >= 3) {
        const first = project(camera, draft.points[0].x, draft.points[0].y);
        if (Math.hypot(first.x - px.x, first.y - px.y) < 9) {
          commitPenDraft(true);
          return;
        }
      }
      const nextDraft: PenDraft = {
        points: [...draft.points, { x: snap(mm.x), y: snap(mm.y) }],
        mouse: null,
      };
      setPenDraft(nextDraft);
      dragRef.current = { kind: 'pen-drag', moved: false };
      return;
    }

    // select tool
    if (selected?.type === 'path') {
      // anchors/handles take priority (screen-space threshold)
      for (let i = 0; i < selected.points.length; i += 1) {
        const p = selected.points[i];
        const ap = project(camera, p.x, p.y);
        if (Math.hypot(ap.x - px.x, ap.y - px.y) < 7) {
          dragRef.current = { kind: 'anchor', layerId: selected.id, index: i, moved: false };
          return;
        }
        for (const which of ['hin', 'hout'] as const) {
          const h = p[which];
          if (!h) continue;
          const hp = project(camera, h.x, h.y);
          if (Math.hypot(hp.x - px.x, hp.y - px.y) < 6) {
            dragRef.current = { kind: 'handle', layerId: selected.id, index: i, which, moved: false };
            return;
          }
        }
      }
    }

    if (selected && (selected.type === 'shape' || selected.type === 'image')) {
      const rotation = selected.type === 'shape' ? selected.rotation : 0;
      if (!rotation) {
        const bbox = layerBbox(selected, panel.widthMm, PANEL_HEIGHT_MM);
        if (bbox) {
          for (const h of resizeHandleRects(rotatedAabb(bbox, rotation), camera)) {
            if (
              px.x >= h.x &&
              px.x <= h.x + h.size &&
              px.y >= h.y &&
              px.y <= h.y + h.size
            ) {
              dragRef.current = {
                kind: 'resize',
                layerId: selected.id,
                handle: h.id,
                orig: { x: selected.x, y: selected.y, width: selected.width, height: selected.height },
                startMm: mm,
                moved: false,
              };
              return;
            }
          }
        }
      }
    }

    const hit = hitTestDoc(doc, mm.x, mm.y);
    if (hit) {
      setSelectedId(hit.id);
      dragRef.current = {
        kind: 'move',
        layerId: hit.id,
        startMm: mm,
        orig: hit,
        moved: false,
      };
    } else {
      setSelectedId(null);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!camera) return;
    const { px, mm } = mmFromEvent(e);
    const drag = dragRef.current;

    if (!drag) {
      if (tool === 'pen' && penDraft) {
        setPenDraft({ ...penDraft, mouse: { x: mm.x, y: mm.y } });
      }
      return;
    }

    switch (drag.kind) {
      case 'pan':
        setCamera(panBy(drag.origCam, px.x - drag.startX, px.y - drag.startY));
        break;
      case 'pen-drag':
        setPenDraft((draft) => {
          if (!draft || draft.points.length === 0) return draft;
          const points = [...draft.points];
          const last = { ...points[points.length - 1] };
          last.hout = { x: mm.x, y: mm.y };
          last.hin = { x: last.x * 2 - mm.x, y: last.y * 2 - mm.y };
          points[points.length - 1] = last;
          return { ...draft, points };
        });
        break;
      case 'move': {
        ensureGesture(drag);
        const dx = mm.x - drag.startMm.x;
        const dy = mm.y - drag.startMm.y;
        const orig = drag.orig;
        if (orig.type === 'path') {
          updateLayer(drag.layerId, translatePathLayer(orig, snap(dx), snap(dy)), {
            commit: false,
          });
        } else if (orig.type !== 'pattern') {
          updateLayer(
            drag.layerId,
            { x: snap(orig.x + dx), y: snap(orig.y + dy) },
            { commit: false },
          );
        }
        break;
      }
      case 'resize': {
        ensureGesture(drag);
        const dx = mm.x - drag.startMm.x;
        const dy = mm.y - drag.startMm.y;
        const o = drag.orig;
        let { x, y, width, height } = o;
        const min = 0.5;
        if (drag.handle.includes('e')) width = Math.max(min, o.width + dx);
        if (drag.handle.includes('s')) height = Math.max(min, o.height + dy);
        if (drag.handle.includes('w')) {
          width = Math.max(min, o.width - dx);
          x = o.x + o.width - width;
        }
        if (drag.handle.includes('n')) {
          height = Math.max(min, o.height - dy);
          y = o.y + o.height - height;
        }
        updateLayer(
          drag.layerId,
          { x: snap(x), y: snap(y), width: snap(width), height: snap(height) },
          { commit: false },
        );
        break;
      }
      case 'anchor': {
        ensureGesture(drag);
        const layer = doc.layers.find((l) => l.id === drag.layerId);
        if (layer?.type === 'path') {
          updateLayer(
            drag.layerId,
            { points: movePathAnchor(layer.points, drag.index, snap(mm.x), snap(mm.y)) },
            { commit: false },
          );
        }
        break;
      }
      case 'handle': {
        ensureGesture(drag);
        const layer = doc.layers.find((l) => l.id === drag.layerId);
        if (layer?.type === 'path') {
          updateLayer(
            drag.layerId,
            {
              points: movePathHandle(layer.points, drag.index, drag.which, mm.x, mm.y, !e.altKey),
            },
            { commit: false },
          );
        }
        break;
      }
    }
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const onDoubleClick = () => {
    if (tool === 'pen' && penDraft && penDraft.points.length >= 2) {
      commitPenDraft(false);
    }
  };

  // --- keyboard --------------------------------------------------------------
  useEffect(() => {
    const isEditable = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isEditable(e.target)) {
        setSpaceDown(true);
        e.preventDefault();
        return;
      }
      if (isEditable(e.target)) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      switch (e.key) {
        case 'Escape':
          if (penDraft) setPenDraft(null);
          else setSelectedId(null);
          break;
        case 'Enter':
          if (penDraft && penDraft.points.length >= 2) commitPenDraft(false);
          break;
        case 'Delete':
        case 'Backspace':
          if (selectedId) deleteLayer(selectedId);
          break;
        case 'v':
          setTool('select');
          break;
        case 'h':
          setTool('pan');
          break;
        case 'z':
          setTool('zoom');
          break;
        case 'p':
          setTool('pen');
          break;
        case 't':
          setTool('text');
          break;
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown': {
          if (!selected || selected.type === 'pattern') break;
          e.preventDefault();
          const step = e.shiftKey ? 1 : 0.1;
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
          if (selected.type === 'path') {
            updateLayer(selected.id, translatePathLayer(selected, dx, dy), { commit: true });
          } else {
            updateLayer(
              selected.id,
              { x: snap(selected.x + dx), y: snap(selected.y + dy) },
              { commit: true },
            );
          }
          break;
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [penDraft, selectedId, selected, undo, redo, deleteLayer, updateLayer, commitPenDraft]);

  // --- UI ----------------------------------------------------------------------
  const zoomPercent = camera ? Math.round((camera.pxPerMm / fitScaleRef.current) * 100) : 100;
  const cursor =
    spaceDown || tool === 'pan'
      ? 'grab'
      : tool === 'zoom'
        ? 'zoom-in'
        : tool === 'pen'
          ? 'crosshair'
          : tool === 'text'
            ? 'text'
            : 'default';

  const traceLayer =
    traceLayerId != null
      ? (doc.layers.find((l) => l.id === traceLayerId && l.type === 'image') as
          | ImageLayer
          | undefined)
      : undefined;
  const traceImage = traceLayer ? imagesRef.current.get(traceLayer.id) : undefined;

  return (
    <div className="app">
      <header className="header">
        <h1>zpd proto</h1>
        <span className="subtitle">blank panel designer — full-surface prototype</span>
        <div className="header-actions">
          <button
            title="Zoom out"
            onClick={() =>
              setCamera((cam) =>
                cam ? zoomAt(cam, canvasSize.w / 2, canvasSize.h / 2, 1 / 1.25) : cam,
              )
            }
          >
            −
          </button>
          <span className="zoom-display">{zoomPercent}%</span>
          <button
            title="Zoom in"
            onClick={() =>
              setCamera((cam) =>
                cam ? zoomAt(cam, canvasSize.w / 2, canvasSize.h / 2, 1.25) : cam,
              )
            }
          >
            +
          </button>
          <button onClick={fitView} title="Fit panel">
            Fit
          </button>
          <button onClick={undo} disabled={!canUndo}>
            ↩ Undo
          </button>
          <button onClick={redo} disabled={!canRedo}>
            ↪ Redo
          </button>
          <button className="primary" onClick={() => downloadDocJson(doc)}>
            ⬇ Download JSON
          </button>
        </div>
      </header>
      <div className="main">
        <div className="toolbar">
          {(
            [
              ['select', 'V', '⬚'],
              ['pan', 'H', '✋'],
              ['zoom', 'Z', '🔍'],
              ['pen', 'P', '✒'],
              ['text', 'T', 'T'],
            ] as const
          ).map(([id, key, icon]) => (
            <button
              key={id}
              className={`tool-btn ${tool === id ? 'active' : ''}`}
              title={`${id} (${key})`}
              onClick={() => {
                setTool(id);
                if (id !== 'pen') setPenDraft(null);
              }}
            >
              {icon}
            </button>
          ))}
          <div className="toolbar-sep" />
          <button className="tool-btn" title="Add rectangle" onClick={() => addShape('rect')}>
            ▭
          </button>
          <button className="tool-btn" title="Add ellipse" onClick={() => addShape('ellipse')}>
            ◯
          </button>
          <button
            className="tool-btn"
            title="Add pattern…"
            onClick={() => setPatternDialog({ mode: 'add' })}
          >
            ▦
          </button>
          <button
            className="tool-btn"
            title="Add image…"
            onClick={() => fileInputRef.current?.click()}
          >
            🖼
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) addImageFromFile(file);
              e.target.value = '';
            }}
          />
        </div>
        <div className="canvas-container" ref={containerRef} style={{ cursor }}>
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onDoubleClick={onDoubleClick}
          />
          {tool === 'pen' && (
            <div className="pen-hint">
              <span>
                click: add point · drag: curve · click first point: close · Enter: open path ·
                Esc: cancel
              </span>
              {penDraft && penDraft.points.length >= 2 && (
                <span className="pen-actions">
                  <button
                    disabled={penDraft.points.length < 3}
                    onClick={() => commitPenDraft(true)}
                  >
                    ⬠ Close path
                  </button>
                  <button onClick={() => commitPenDraft(false)}>Finish open</button>
                  <button onClick={() => setPenDraft(null)}>Cancel</button>
                </span>
              )}
            </div>
          )}
        </div>
        <aside className="sidebar">
          <section>
            <h2>Panel</h2>
            <label className="row">
              <span>Size</span>
              <select
                value={doc.panelHp}
                onChange={(e) => commit({ ...doc, panelHp: Number(e.target.value) })}
              >
                {PANEL_SIZES.map((s) => (
                  <option key={s.hp} value={s.hp}>
                    {s.hp}HP — {s.widthMm}×{PANEL_HEIGHT_MM}mm
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section>
            <h2>Palette (fixed)</h2>
            <div className="palette-row">
              {PALETTE.map((p) => (
                <div key={p.name} className="palette-chip" title={p.note}>
                  <span className="swatch" style={{ background: p.hex }} />
                  <span>{p.name}</span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2>Layers</h2>
            <ul className="layer-list">
              {[...doc.layers].reverse().map((layer) => (
                <li
                  key={layer.id}
                  className={layer.id === selectedId ? 'selected' : ''}
                  onClick={() => setSelectedId(layer.id)}
                >
                  <span className="layer-type">{typeIcon(layer)}</span>
                  <span
                    className="swatch small"
                    style={{ background: PALETTE[layerColor(layer)].hex }}
                  />
                  <span className="layer-name">
                    {layer.name}
                    {layer.hidden ? ' (hidden)' : ''}
                  </span>
                  <span className="layer-buttons">
                    <button title="up" onClick={(e) => { e.stopPropagation(); moveLayerInList(layer.id, 1); }}>▲</button>
                    <button title="down" onClick={(e) => { e.stopPropagation(); moveLayerInList(layer.id, -1); }}>▼</button>
                    <button
                      title="toggle visibility"
                      onClick={(e) => {
                        e.stopPropagation();
                        updateLayer(layer.id, { hidden: !layer.hidden }, { commit: true });
                      }}
                    >
                      {layer.hidden ? '🚫' : '👁'}
                    </button>
                    <button title="delete" onClick={(e) => { e.stopPropagation(); deleteLayer(layer.id); }}>✕</button>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {selected && (
            <section>
              <h2>Properties — {selected.type}</h2>
              <Inspector
                layer={selected}
                onChange={(patch, options) => updateLayer(selected.id, patch, options)}
                onBrowsePatterns={() =>
                  setPatternDialog({ mode: 'change', layerId: selected.id })
                }
                onTrace={() => setTraceLayerId(selected.id)}
                onFontChange={(family) => {
                  void ensureFontLoaded(family).then(bumpAssets);
                }}
              />
            </section>
          )}
        </aside>
      </div>

      {patternDialog && (
        <PatternDialog
          onClose={() => setPatternDialog(null)}
          onSelect={(name) => {
            if (patternDialog.mode === 'add') {
              addPattern(name);
            } else {
              const gen = patternByName(name);
              updateLayer(
                patternDialog.layerId,
                { patternType: gen.name, name: gen.displayName, params: defaultParams(gen) },
                { commit: true },
              );
            }
            setPatternDialog(null);
          }}
        />
      )}

      {traceLayer && traceImage && (
        <TraceDialog
          layer={traceLayer}
          image={traceImage}
          onClose={() => setTraceLayerId(null)}
          onApply={(pathLayers) => applyTrace(traceLayer.id, pathLayers)}
        />
      )}
    </div>
  );
}

function layerColor(layer: Layer): ColorIndex {
  switch (layer.type) {
    case 'path':
      return layer.fill ?? layer.stroke ?? 1;
    case 'image':
      return 0;
    default:
      return layer.color;
  }
}

function typeIcon(layer: Layer): string {
  switch (layer.type) {
    case 'shape':
      return layer.shape === 'rect' ? '▭' : '◯';
    case 'pattern':
      return '▦';
    case 'path':
      return '✒';
    case 'text':
      return 'T';
    case 'image':
      return '🖼';
  }
}

function Inspector({
  layer,
  onChange,
  onBrowsePatterns,
  onTrace,
  onFontChange,
}: {
  layer: Layer;
  onChange: (patch: Partial<Layer>, options: { commit: boolean }) => void;
  onBrowsePatterns: () => void;
  onTrace: () => void;
  onFontChange: (family: string) => void;
}) {
  const colorPicker = (
    value: ColorIndex | null,
    onPick: (c: ColorIndex | null) => void,
    allowNone = false,
  ) => (
    <div className="color-picker">
      {PALETTE.map((p, i) => (
        <button
          key={p.name}
          className={`swatch-btn ${value === i ? 'active' : ''}`}
          style={{ background: p.hex }}
          title={p.name}
          onClick={() => onPick(i as ColorIndex)}
        />
      ))}
      {allowNone && (
        <button
          className={`swatch-btn none ${value === null ? 'active' : ''}`}
          title="none"
          onClick={() => onPick(null)}
        >
          ∅
        </button>
      )}
    </div>
  );

  const numberRow = (label: string, value: number, onCommit: (v: number) => void, step = 0.1) => (
    <label className="row" key={label}>
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onCommit(Number(e.target.value))}
      />
    </label>
  );

  switch (layer.type) {
    case 'shape':
      return (
        <div className="props-grid">
          <div className="row">
            <span>Color</span>
            {colorPicker(layer.color, (c) => c !== null && onChange({ color: c }, { commit: true }))}
          </div>
          {numberRow('x (mm)', layer.x, (v) => onChange({ x: v }, { commit: true }))}
          {numberRow('y (mm)', layer.y, (v) => onChange({ y: v }, { commit: true }))}
          {numberRow('width (mm)', layer.width, (v) => onChange({ width: v }, { commit: true }))}
          {numberRow('height (mm)', layer.height, (v) => onChange({ height: v }, { commit: true }))}
          {numberRow('rotation (°)', layer.rotation ?? 0, (v) => onChange({ rotation: v }, { commit: true }), 1)}
        </div>
      );
    case 'pattern': {
      const gen = patternByName(layer.patternType);
      return (
        <div className="props-grid">
          <div className="row">
            <span>Pattern</span>
            <button onClick={onBrowsePatterns}>{gen.displayName} — Browse…</button>
          </div>
          <div className="row">
            <span>Color</span>
            {colorPicker(layer.color, (c) => c !== null && onChange({ color: c }, { commit: true }))}
          </div>
          {gen.paramDefs.map((def) => (
            <label key={def.key} className="row">
              <span>{def.label}</span>
              <input
                type="range"
                min={def.min}
                max={def.max}
                step={def.step}
                value={layer.params[def.key] ?? def.defaultValue}
                onChange={(e) =>
                  onChange(
                    { params: { ...layer.params, [def.key]: Number(e.target.value) } },
                    { commit: true },
                  )
                }
              />
            </label>
          ))}
        </div>
      );
    }
    case 'path':
      return (
        <div className="props-grid">
          <div className="row">
            <span>Fill</span>
            {colorPicker(layer.fill, (c) => onChange({ fill: c }, { commit: true }), true)}
          </div>
          <div className="row">
            <span>Stroke</span>
            {colorPicker(layer.stroke, (c) => onChange({ stroke: c }, { commit: true }), true)}
          </div>
          {numberRow('stroke w (mm)', layer.strokeWidth, (v) =>
            onChange({ strokeWidth: v }, { commit: true }),
          )}
          <label className="row">
            <span>Closed</span>
            <input
              type="checkbox"
              checked={layer.closed}
              onChange={(e) => onChange({ closed: e.target.checked }, { commit: true })}
            />
          </label>
          <p className="hint">drag anchors/handles on canvas to edit nodes (Alt = break mirror)</p>
        </div>
      );
    case 'text':
      return (
        <div className="props-grid">
          <label className="row">
            <span>Text</span>
            <textarea
              rows={2}
              value={layer.content}
              onChange={(e) => onChange({ content: e.target.value }, { commit: true })}
            />
          </label>
          <label className="row">
            <span>Font</span>
            <select
              value={layer.fontFamily}
              onChange={(e) => {
                onFontChange(e.target.value);
                onChange({ fontFamily: e.target.value }, { commit: true });
              }}
            >
              {GOOGLE_FONTS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <div className="row">
            <span>Color</span>
            {colorPicker(layer.color, (c) => c !== null && onChange({ color: c }, { commit: true }))}
          </div>
          {numberRow('size (mm)', layer.sizeMm, (v) => onChange({ sizeMm: v }, { commit: true }))}
          {numberRow('x (mm)', layer.x, (v) => onChange({ x: v }, { commit: true }))}
          {numberRow('y (mm)', layer.y, (v) => onChange({ y: v }, { commit: true }))}
          {numberRow('rotation (°)', layer.rotation ?? 0, (v) => onChange({ rotation: v }, { commit: true }), 1)}
        </div>
      );
    case 'image':
      return (
        <div className="props-grid">
          {numberRow('x (mm)', layer.x, (v) => onChange({ x: v }, { commit: true }))}
          {numberRow('y (mm)', layer.y, (v) => onChange({ y: v }, { commit: true }))}
          {numberRow('width (mm)', layer.width, (v) => onChange({ width: v }, { commit: true }))}
          {numberRow('height (mm)', layer.height, (v) => onChange({ height: v }, { commit: true }))}
          <button className="primary" onClick={onTrace}>
            Convert to vector…
          </button>
          <p className="hint">
            images are design-time sources — the final panel is made only of vector layers
          </p>
        </div>
      );
  }
}
