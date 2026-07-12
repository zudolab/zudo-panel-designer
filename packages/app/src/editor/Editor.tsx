// The editor shell: owns document/camera/selection/tool state and wires the
// canvas + registries together. Everything domain-specific (how a tool reacts,
// how a layer inspects, what a dialog shows) lives in the registered modules —
// this component only routes events to the ACTIVE tool first, then falls back
// to app-level shortcuts.
//
// Importing ./registry runs the import.meta.glob auto-discovery (tools /
// inspectors / add-actions / dialogs register themselves as a side effect).
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  PANEL_HEIGHT_MM,
  panelWidthMm,
  snapToGrid,
  translatePathLayer,
  type Layer,
} from '@zpd/core';
import { fit, project, unproject, zoomAt, type Camera } from './camera';
import { renderScene } from './renderer';
import { getTool, toolByShortcut } from './registry';
import { closeDialog, openDialog } from './registry/dialogs';
import { createDemoDoc } from './demo-doc';
import { installTestBridge } from './test-bridge';
import { useDocHistory } from './use-doc-history';
import type { PanelDims, ToolContext, ToolKeyEvent, ToolPointerEvent } from './types';
import { CanvasViewport } from './components/canvas-viewport';
import { DialogHost } from './components/dialog-host';
import { Header } from './components/header';
import { Sidebar } from './components/sidebar';
import { Toolbar } from './components/toolbar';

const FALLBACK_CAMERA: Camera = { pxPerMm: 1, offsetX: 0, offsetY: 0 };
const snap = (v: number) => snapToGrid(v, 0.1);

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
  );
}

export function Editor() {
  const { doc, canUndo, canRedo, commit, replace, beginGesture, undo, redo } =
    useDocHistory(createDemoDoc());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeToolId, setActiveToolId] = useState('select');
  const [camera, setCameraState] = useState<Camera | null>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const [spaceDown, setSpaceDown] = useState(false);
  const [, setAssetVersion] = useState(0); // bump repaints when an image loads
  const [, setRepaintNonce] = useState(0); // tools ask for repaints via ctx

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imagesRef = useRef(new Map<string, HTMLImageElement>());
  // pxPerMm at the current fit — the 100% reference for the zoom % display
  const [fitScale, setFitScale] = useState(4);

  const panel: PanelDims = useMemo(
    () => ({ widthMm: panelWidthMm(doc.panelHp), heightMm: PANEL_HEIGHT_MM }),
    [doc.panelHp],
  );
  const selectedLayer = useMemo(
    () => doc.layers.find((l) => l.id === selectedId) ?? null,
    [doc.layers, selectedId],
  );

  // Live refs so the ToolContext getters always read the latest committed
  // state (never a stale render closure), even mid-gesture. Synced in an effect
  // (not during render) — tool handlers only run after commit+effects, so by
  // the next event the refs are current.
  const docRef = useRef(doc);
  const cameraRef = useRef(camera);
  const selectedIdRef = useRef(selectedId);
  const panelRef = useRef(panel);
  useEffect(() => {
    docRef.current = doc;
    cameraRef.current = camera;
    selectedIdRef.current = selectedId;
    panelRef.current = panel;
  });

  // e2e test bridge (Wave 6, #13) — reads through the same live refs as ctx,
  // so it never lags a commit. See test-bridge.ts for the prod/dev gating.
  useEffect(() => {
    installTestBridge({
      getDoc: () => docRef.current,
      getSelectedId: () => selectedIdRef.current,
      getCamera: () => cameraRef.current,
    });
  }, []);

  // Built once — all mutators are stable, all reads go through refs.
  const ctx = useMemo<ToolContext>(
    () => ({
      get doc() {
        return docRef.current;
      },
      get camera() {
        return cameraRef.current ?? FALLBACK_CAMERA;
      },
      get panel() {
        return panelRef.current;
      },
      get selectedId() {
        return selectedIdRef.current;
      },
      get selectedLayer() {
        const id = selectedIdRef.current;
        return docRef.current.layers.find((l) => l.id === id) ?? null;
      },
      toMm: (screenPt) => (cameraRef.current ? unproject(cameraRef.current, screenPt) : { x: 0, y: 0 }),
      toScreen: (mmPt) => (cameraRef.current ? project(cameraRef.current, mmPt) : { x: 0, y: 0 }),
      commit,
      replace,
      beginGesture,
      undo,
      redo,
      select: setSelectedId,
      setCamera: (next) =>
        setCameraState((prev) =>
          typeof next === 'function' ? (prev ? next(prev) : prev) : next,
        ),
      setActiveTool: setActiveToolId,
      requestRepaint: () => setRepaintNonce((n) => n + 1),
      openDialog,
      closeDialog,
    }),
    [commit, replace, beginGesture, undo, redo],
  );

  // --- container measurement + fit ---------------------------------------
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setCanvasSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fitView = useCallback(() => {
    const el = containerRef.current;
    if (!el || el.clientWidth === 0) return;
    const cam = fit(panel.widthMm, panel.heightMm, { width: el.clientWidth, height: el.clientHeight });
    setFitScale(cam.pxPerMm);
    setCameraState(cam);
  }, [panel.widthMm, panel.heightMm]);

  const measured = canvasSize.w > 0;
  useEffect(() => {
    // first measure and every panel-size change re-fits (fitView identity
    // changes with panel.widthMm, so panelHp changes re-run this)
    if (measured) fitView();
  }, [measured, doc.panelHp, fitView]);

  // --- image asset loading -----------------------------------------------
  useEffect(() => {
    for (const layer of doc.layers) {
      if (layer.type === 'image' && !imagesRef.current.has(layer.id)) {
        const img = new Image();
        img.onload = () => setAssetVersion((v) => v + 1);
        img.src = layer.src;
        imagesRef.current.set(layer.id, img);
      }
    }
  }, [doc.layers]);

  // --- tool activate / deactivate ----------------------------------------
  const prevToolRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevToolRef.current;
    if (prev !== activeToolId) {
      if (prev) getTool(prev)?.onDeactivate?.(ctx);
      getTool(activeToolId)?.onActivate?.(ctx);
      prevToolRef.current = activeToolId;
    }
  }, [activeToolId, ctx]);

  // --- full repaint (runs every render; cheap, matches proto) ------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !camera || canvasSize.w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvasSize.w * dpr);
    canvas.height = Math.round(canvasSize.h * dpr);
    canvas.style.width = `${canvasSize.w}px`;
    canvas.style.height = `${canvasSize.h}px`;
    const activeTool = getTool(activeToolId);
    renderScene(canvas, doc, panel, camera, {
      selectedId,
      images: imagesRef.current,
      showNodes: activeToolId === 'select' && selectedLayer?.type === 'path',
      renderDraft: activeTool?.renderDraft ? (d) => activeTool.renderDraft?.(d, ctx) : undefined,
    });
  });

  // --- wheel zoom (non-passive, anchored at the pointer) -----------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * 0.0015);
      setCameraState((cam) =>
        cam ? zoomAt(cam, { x: e.clientX - rect.left, y: e.clientY - rect.top }, factor) : cam,
      );
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  // --- keyboard: active tool first, then app-level fallbacks -------------
  useEffect(() => {
    const deleteSelected = () => {
      const id = selectedIdRef.current;
      if (!id) return;
      commit({ ...docRef.current, layers: docRef.current.layers.filter((l) => l.id !== id) });
      setSelectedId(null);
    };
    const nudge = (dx: number, dy: number) => {
      const layer = ctx.selectedLayer;
      if (!layer || layer.type === 'pattern') return;
      const patch =
        layer.type === 'path'
          ? translatePathLayer(layer, dx, dy)
          : { x: snap(layer.x + dx), y: snap(layer.y + dy) };
      commit({
        ...docRef.current,
        layers: docRef.current.layers.map((l) => (l.id === layer.id ? ({ ...l, ...patch } as Layer) : l)),
      });
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isEditableTarget(e.target)) {
        setSpaceDown(true);
        e.preventDefault();
        return;
      }
      if (isEditableTarget(e.target)) return;

      const keyEvent: ToolKeyEvent = {
        key: e.key,
        code: e.code,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        preventDefault: () => e.preventDefault(),
      };
      if (getTool(activeToolId)?.onKeyDown?.(keyEvent, ctx) === true) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        const tool = toolByShortcut(e.key);
        if (tool) {
          setActiveToolId(tool.id);
          return;
        }
      }
      switch (e.key) {
        case 'Escape':
          setSelectedId(null);
          break;
        case 'Delete':
        case 'Backspace':
          deleteSelected();
          break;
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown': {
          const step = e.shiftKey ? 1 : 0.1;
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
          if (dx || dy) {
            e.preventDefault();
            nudge(dx, dy);
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
  }, [activeToolId, ctx, commit, undo, redo]);

  // --- pointer routing to the active (or Space-override pan) tool ---------
  const effectiveToolId = spaceDown ? 'pan' : activeToolId;
  const toPointer = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>): ToolPointerEvent => {
      const rect = e.currentTarget.getBoundingClientRect();
      const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const mm = cameraRef.current ? unproject(cameraRef.current, screen) : { x: 0, y: 0 };
      return {
        screen,
        mm,
        button: e.button,
        buttons: e.buttons,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        pointerId: e.pointerId,
        preventDefault: () => e.preventDefault(),
      };
    },
    [],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!cameraRef.current) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // synthetic pointer events (tests) have no active pointer to capture
    }
    getTool(effectiveToolId)?.onPointerDown?.(toPointer(e), ctx);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!cameraRef.current) return;
    getTool(effectiveToolId)?.onPointerMove?.(toPointer(e), ctx);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    getTool(effectiveToolId)?.onPointerUp?.(toPointer(e), ctx);
  };
  const onDoubleClick = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    getTool(effectiveToolId)?.onDoubleClick?.(toPointer(e), ctx);
  };

  const zoomPercent = camera ? Math.round((camera.pxPerMm / fitScale) * 100) : 100;
  const cursor = spaceDown ? 'grab' : (getTool(effectiveToolId)?.cursor ?? 'default');
  const onZoomStep = (factor: number) =>
    setCameraState((cam) =>
      cam ? zoomAt(cam, { x: canvasSize.w / 2, y: canvasSize.h / 2 }, factor) : cam,
    );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-neutral-950 text-neutral-100">
      <Header
        ctx={ctx}
        zoomPercent={zoomPercent}
        canUndo={canUndo}
        canRedo={canRedo}
        onFit={fitView}
        onZoomStep={onZoomStep}
      />
      <div className="flex min-h-0 flex-1">
        <Toolbar ctx={ctx} activeToolId={activeToolId} />
        <CanvasViewport
          containerRef={containerRef}
          canvasRef={canvasRef}
          cursor={cursor}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDoubleClick={onDoubleClick}
        />
        <Sidebar ctx={ctx} selectedId={selectedId} selectedLayer={selectedLayer} />
      </div>
      <DialogHost ctx={ctx} />
    </div>
  );
}
