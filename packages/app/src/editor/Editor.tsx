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
  mapPcbLeavesById,
  PANEL_HEIGHT_MM,
  panelWidthMm,
  translatePathLayer,
  type DocState,
  type Layer,
} from '@zpd/core';
import { projectFlatLayers } from './flat-projection';
import { fit, project, unproject, zoomAt, type Camera } from './camera';
import { installBrowserZoomGuard } from './browser-zoom-guard';
import { reconcileImageCache, renderScene } from './renderer';
import { getTool } from './registry';
import { closeDialog, getOpenDialog, openDialog } from './registry/dialogs';
import { dispatchCommand, type CommandContext } from './commands';
import { createDemoDoc } from './demo-doc';
import { readDoc } from './doc-store';
import { normalizeSelectedIds } from './selection';
import {
  expandSelectionToLeafIds,
  resolveSelectionLeaves,
  resolveSelectionOverlayMode,
} from './selection-resolve';
import { installTestBridge } from './test-bridge';
import { isEditableTarget } from './is-editable-target';
import { useAutosave } from './use-autosave';
import { useClipboard } from './use-clipboard';
import { useDocHistory } from './use-doc-history';
import { useGuideDrag, type GuideDragDeps } from './use-guide-drag';
import type { PanelDims, ToolContext, ToolKeyEvent, ToolPointerEvent } from './types';
import { CanvasViewport } from './components/canvas-viewport';
import { RulerCorner, RulerStrip } from './components/ruler';
import { DialogHost } from './components/dialog-host';
import { DropImport } from './components/drop-import';
import { Header } from './components/header';
import { Sidebar } from './components/sidebar';
import { Toolbar } from './components/toolbar';
import { ToastContainer } from './components/toast/toast-container';

const FALLBACK_CAMERA: Camera = { pxPerMm: 1, offsetX: 0, offsetY: 0 };

export function Editor() {
  // Boot restore (#72): the stored doc when present, else the first-visit
  // demo doc. Lazy useState initializer — readDoc() does a synchronous
  // localStorage read + parse, and this form guarantees it runs only once.
  const [initialDoc] = useState<DocState>(() => readDoc() ?? createDemoDoc());
  const {
    history: historyState,
    doc,
    canUndo,
    canRedo,
    commit,
    replace,
    reset,
    beginGesture,
    abortGesture,
    undo,
    redo,
  } = useDocHistory(initialDoc);
  const saveStatus = useAutosave(doc);
  // Selection state (#44): the stored ids are RAW (exactly what select() /
  // selectIds() was given); every read derives the normalized view (de-duped,
  // doc-order, stale ids dropped) via normalizeSelectedIds. Lazy on purpose —
  // see selection.ts for why eager filtering would break select-after-commit.
  const [rawSelectedIds, setRawSelectedIds] = useState<readonly string[]>([]);
  const [activeToolId, setActiveToolId] = useState('select');
  const [camera, setCameraState] = useState<Camera | null>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const [spaceDown, setSpaceDown] = useState(false);
  // "Show content outside the panel" (issue #43) — default ON, not persisted
  // (view-only state, unlike the doc itself which autosaves — see #72).
  const [showOutsidePanel, setShowOutsidePanel] = useState(true);
  // "Show guides" master toggle (issue #54) — default ON, not persisted
  // (view-only state; see showOutsidePanel above). When OFF, guides neither
  // render nor accept drag interaction.
  const [showGuides, setShowGuides] = useState(true);
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
  // Normalized against the TREE (#151): selectedIds may hold group ids, which
  // a flat projection would wrongly drop as stale.
  const selectedIds = useMemo(
    () => normalizeSelectedIds(rawSelectedIds, doc.layers),
    [rawSelectedIds, doc.layers],
  );
  // The flat-leaf view of the selection for the chrome pass (#151): a selected
  // group id draws per-leaf chrome on its descendants (renderScene consumes
  // flat leaf ids only; the combined-bbox group chrome is #152's). The overlay
  // mode rides along so a one-child group — which also expands to exactly one
  // leaf id — never wears the single-layer handles the tool won't serve.
  const chromeLeafIds = useMemo(
    () => expandSelectionToLeafIds(doc.layers, selectedIds),
    [doc.layers, selectedIds],
  );
  const overlayMode = useMemo(
    () => resolveSelectionOverlayMode(doc.layers, selectedIds),
    [doc.layers, selectedIds],
  );
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  const selectedLayer = useMemo(
    () => projectFlatLayers(doc.layers).find((l) => l.id === selectedId) ?? null,
    [doc.layers, selectedId],
  );

  // Live refs so the ToolContext getters always read the latest committed
  // state (never a stale render closure), even mid-gesture. Synced in an effect
  // (not during render) — tool handlers only run after commit+effects, so by
  // the next event the refs are current.
  const docRef = useRef(doc);
  const historyRef = useRef(historyState);
  const cameraRef = useRef(camera);
  const rawSelectedIdsRef = useRef(rawSelectedIds);
  const panelRef = useRef(panel);
  const showGuidesRef = useRef(showGuides);
  // canvasSize as a ref too (issue #76): lets zoomStep below stay a STABLE
  // callback (empty deps) instead of recreated every resize — see zoomStep.
  const canvasSizeRef = useRef(canvasSize);
  useEffect(() => {
    docRef.current = doc;
    historyRef.current = historyState;
    cameraRef.current = camera;
    rawSelectedIdsRef.current = rawSelectedIds;
    panelRef.current = panel;
    showGuidesRef.current = showGuides;
    canvasSizeRef.current = canvasSize;
  });

  // The normalized live view of the selection — what ctx and the test bridge
  // read. Single-selection views derive from it (non-null iff exactly one).
  const readSelectedIds = useCallback(
    () => normalizeSelectedIds(rawSelectedIdsRef.current, docRef.current.layers),
    [],
  );
  const readSelectedId = useCallback(() => {
    const ids = readSelectedIds();
    return ids.length === 1 ? ids[0] : null;
  }, [readSelectedIds]);

  // e2e test bridge (Wave 6, #13) — reads through the same live refs as ctx,
  // so it never lags a commit. See test-bridge.ts for the prod/dev gating.
  useEffect(() => {
    installTestBridge({
      getDoc: () => docRef.current,
      getHistory: () => historyRef.current,
      getSelectedId: () => readSelectedId(),
      getSelectedIds: () => readSelectedIds(),
      getCamera: () => cameraRef.current,
    });
  }, [readSelectedId, readSelectedIds]);

  // Browser zoom desyncs the cursor position reported to the app from the
  // actual screen position, which misaligns drag handles / resize handles /
  // click targets (#62). Installed once for the app's lifetime; the canvas's
  // own wheel handler (below) keeps handling in-app zoom unchanged.
  useEffect(() => installBrowserZoomGuard(), []);

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
      get selectedIds() {
        return readSelectedIds();
      },
      get selectedId() {
        return readSelectedId();
      },
      get selectedLayer() {
        const id = readSelectedId();
        return projectFlatLayers(docRef.current.layers).find((l) => l.id === id) ?? null;
      },
      get flatLayers() {
        return projectFlatLayers(docRef.current.layers);
      },
      toMm: (screenPt) =>
        cameraRef.current ? unproject(cameraRef.current, screenPt) : { x: 0, y: 0 },
      toScreen: (mmPt) => (cameraRef.current ? project(cameraRef.current, mmPt) : { x: 0, y: 0 }),
      commit,
      replace,
      reset,
      beginGesture,
      abortGesture,
      undo,
      redo,
      select: (id) => setRawSelectedIds(id === null ? [] : [id]),
      selectIds: (ids) => setRawSelectedIds(ids),
      setCamera: (next) =>
        setCameraState((prev) => (typeof next === 'function' ? (prev ? next(prev) : prev) : next)),
      setActiveTool: setActiveToolId,
      requestRepaint: () => setRepaintNonce((n) => n + 1),
      evictImageCache: (layers) => reconcileImageCache(imagesRef.current, layers),
      openDialog,
      closeDialog,
    }),
    [
      commit,
      replace,
      reset,
      beginGesture,
      abortGesture,
      undo,
      redo,
      readSelectedId,
      readSelectedIds,
    ],
  );

  // Clipboard (#74): Cmd/Ctrl+C/X/D/A (wired into the keydown fallback below)
  // plus its own self-contained window `paste` listener — the SOLE Cmd/Ctrl+V
  // path (see use-clipboard.ts; deliberately no 'v' case in the switch below).
  const clipboard = useClipboard(ctx);

  // Guide drag controller (#54): the cross-component ruler->canvas pointer
  // routing. Deps read the same live refs as ctx so the window listeners never
  // lag a commit; see use-guide-drag.ts for the routing design.
  const guideDragDeps = useMemo<GuideDragDeps>(
    () => ({
      getCamera: () => cameraRef.current,
      getDoc: () => docRef.current,
      getCanvasRect: () => canvasRef.current?.getBoundingClientRect() ?? null,
      commit,
      isEnabled: () => showGuidesRef.current,
    }),
    [commit],
  );
  const guideDrag = useGuideDrag(guideDragDeps);

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

  // Stable (empty deps): reads panel size through panelRef rather than a
  // closed-over `panel`, so this identity never changes across renders. That
  // matters for the command registry (issue #76) — ctx.zoomFit below embeds
  // this directly, and a stable identity keeps it safe to call from any
  // render without going stale.
  const fitView = useCallback(() => {
    const el = containerRef.current;
    if (!el || el.clientWidth === 0) return;
    const cam = fit(panelRef.current.widthMm, panelRef.current.heightMm, {
      width: el.clientWidth,
      height: el.clientHeight,
    });
    setFitScale(cam.pxPerMm);
    setCameraState(cam);
  }, []);

  // Also stable — reads canvasSizeRef instead of the closed-over canvasSize,
  // same reasoning as fitView above. Identical math to the pre-#76 inline
  // onZoomStep; only the state source changed (ref instead of closure).
  const zoomStep = useCallback((factor: number) => {
    setCameraState((cam) =>
      cam
        ? zoomAt(cam, { x: canvasSizeRef.current.w / 2, y: canvasSizeRef.current.h / 2 }, factor)
        : cam,
    );
  }, []);

  // The command registry's execution context (issue #77): the SAME object
  // the keydown fallback below dispatches through AND the one DialogHost
  // hands to every dialog's `ctx` prop — so the command palette (a dialog)
  // can run any registry command exactly like a keydown would. Built with
  // getters delegating to `ctx` rather than `{...ctx}` — spreading a
  // getter-based object snapshots its CURRENT values into plain properties,
  // which would silently break the "commands read ctx FRESH" contract this
  // registry relies on (see commands.ts's header comment). Stable identity:
  // ctx/clipboard/zoomStep/fitView are themselves stable across renders.
  const commandCtx = useMemo<CommandContext>(
    () => ({
      get doc() {
        return ctx.doc;
      },
      get camera() {
        return ctx.camera;
      },
      get panel() {
        return ctx.panel;
      },
      get selectedIds() {
        return ctx.selectedIds;
      },
      get selectedId() {
        return ctx.selectedId;
      },
      get selectedLayer() {
        return ctx.selectedLayer;
      },
      get flatLayers() {
        return ctx.flatLayers;
      },
      toMm: ctx.toMm,
      toScreen: ctx.toScreen,
      commit: ctx.commit,
      replace: ctx.replace,
      reset: ctx.reset,
      beginGesture: ctx.beginGesture,
      abortGesture: ctx.abortGesture,
      undo: ctx.undo,
      redo: ctx.redo,
      select: ctx.select,
      selectIds: ctx.selectIds,
      setCamera: ctx.setCamera,
      setActiveTool: ctx.setActiveTool,
      requestRepaint: ctx.requestRepaint,
      evictImageCache: ctx.evictImageCache,
      openDialog: ctx.openDialog,
      closeDialog: ctx.closeDialog,
      clipboard: {
        handleCopy: clipboard.handleCopy,
        handleCut: clipboard.handleCut,
        handleDuplicate: clipboard.handleDuplicate,
        handleSelectAll: clipboard.handleSelectAll,
      },
      zoomIn: () => zoomStep(1.25),
      zoomOut: () => zoomStep(1 / 1.25),
      zoomFit: () => fitView(),
    }),
    [ctx, clipboard, zoomStep, fitView],
  );

  const measured = canvasSize.w > 0;
  useEffect(() => {
    // first measure and every panel-size change re-fits (fitView identity
    // changes with panel.widthMm, so panelHp changes re-run this)
    if (measured) fitView();
  }, [measured, doc.panelHp, fitView]);

  // --- image asset loading -----------------------------------------------
  useEffect(() => {
    for (const layer of projectFlatLayers(doc.layers)) {
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
    // renderScene needs the ROLE-AWARE stack (#179): it derives the role
    // slices for inverted mask compositing AND the flat projection for
    // ghosts/chrome itself. Pre-flattening here would erase container
    // membership before rendering. Identity stability is preserved — core's
    // WeakMap projection returns one flat array per committed tree, so text
    // geometry's incarnation tracking still sees one incarnation per commit.
    renderScene(canvas, doc, panel, camera, {
      // Expanded to leaf ids (#151): the chrome pass matches flat leaves only,
      // so a raw group id would draw no selection chrome at all.
      selectedIds: chromeLeafIds,
      singleSelection: overlayMode === 'single',
      images: imagesRef.current,
      showNodes: activeToolId === 'select' && selectedLayer?.type === 'path',
      showOutsidePanel,
      guides: showGuides ? doc.guides : [],
      guideDraft: showGuides ? guideDrag.draft : null,
      // Live multi-rotate gesture chrome (#152): the streaming tool owns the
      // frozen bounds/pivot + live delta; the chrome pass draws them instead
      // of re-deriving (pulsating) live AABBs.
      multiRotate: activeTool?.multiRotateChrome?.(ctx) ?? null,
      renderDraft: activeTool?.renderDraft ? (d) => activeTool.renderDraft?.(d, ctx) : undefined,
      requestRepaint: ctx.requestRepaint,
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
    const nudge = (dx: number, dy: number) => {
      // Nudges the WHOLE selection as ONE undo entry (#45). Pattern members
      // nudge too since #97 — their x/y square translates like any layer.
      //
      // Every layer gets the SAME (dx, dy) delta so the selection translates
      // as a rigid unit — snapping each layer's absolute position
      // independently would apply different effective deltas to off-grid
      // members (allowed via the numeric inspectors) and shear the group. dx/dy
      // are already grid steps (0.1 / 1mm), and this matches translatePathLayer,
      // which already moves paths by the raw delta.
      const ids = readSelectedIds();
      if (ids.length === 0) return;
      // Group-aware expansion (#151): a selected group id nudges its EDITABLE
      // descendant leaves (hidden — intrinsic or ancestor-folded — excluded),
      // one shared delta for the whole selection like multi-move.
      const tree = docRef.current.layers;
      const { editableLeafIds } = resolveSelectionLeaves(tree, ids, projectFlatLayers(tree));
      // mapLeavesById nudges matching leaves at ANY depth and only leaves —
      // group nodes never carry x/y (structure + hidden only, see types.ts).
      const layers = mapPcbLeavesById(tree, editableLeafIds, (l) => {
        const patch =
          l.type === 'path' ? translatePathLayer(l, dx, dy) : { x: l.x + dx, y: l.y + dy };
        return { ...l, ...patch } as Layer;
      });
      // Same tree reference back = no editable leaf matched (e.g. a fully
      // hidden selection) — skip the commit so no phantom undo entry is pushed.
      if (layers === tree) return;
      commit({ ...docRef.current, layers });
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // A dialog owns the keyboard while it's open: none of this app-level
      // fallback chain (Space-hold pan arming, tool shortcuts, Delete/nudge,
      // clipboard C/X/D/A, undo/redo, Escape-deselect) may run behind the
      // modal. Space must reach a focused dialog button as its native
      // activation, not be preventDefault'd into pan-arming; doc-mutating keys
      // must not leak through. Escape-to-close is unaffected — it lives in the
      // dialog host's own document listener (dialog-host.tsx), not here.
      if (getOpenDialog() !== null) return;

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

      // Registry dispatch (#76): undo/redo, clipboard C/X/D/A, tool switches
      // (derived from the tool registry), delete, deselect, help/palette
      // (#77) — see commands.ts for the exact parity mapping from the
      // pre-refactor branches this replaced. commandCtx is the SAME stable
      // object DialogHost hands to dialogs — see its definition above.
      if (dispatchCommand(keyEvent, commandCtx)) return;

      // Nudge stays bespoke (display-only in the registry — see commands.ts):
      // 4 arrow keys plus a Shift-scaled step size don't collapse into one
      // chord/command. Unconditional on modifiers, same as before #76 (the
      // pre-refactor switch had no modifier gate here either).
      switch (e.key) {
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
  }, [activeToolId, ctx, commit, readSelectedIds, commandCtx]);

  // --- pointer routing to the active (or Space-override pan) tool ---------
  const effectiveToolId = spaceDown ? 'pan' : activeToolId;
  const toPointer = useCallback((e: ReactPointerEvent<HTMLCanvasElement>): ToolPointerEvent => {
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
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!cameraRef.current) return;
    // Guide grab (#54) wins over tool routing: if the pointer landed on an
    // existing guide line, start a guide move/delete drag and don't let the
    // active tool see the event. Skipped while Space-panning.
    if (!spaceDown && guideDrag.tryGrabOnCanvas(e)) return;
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
  // pointercancel (#152): the browser revoked the pointer (OS gesture, touch
  // interruption). Tools that opt in treat it exactly as pointerup.
  const onPointerCancel = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    getTool(effectiveToolId)?.onPointerCancel?.(toPointer(e), ctx);
  };
  const onPointerLeave = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    getTool(effectiveToolId)?.onPointerLeave?.(toPointer(e), ctx);
  };
  const onDoubleClick = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    getTool(effectiveToolId)?.onDoubleClick?.(toPointer(e), ctx);
  };

  const zoomPercent = camera ? Math.round((camera.pxPerMm / fitScale) * 100) : 100;
  const cursor = spaceDown ? 'grab' : (getTool(effectiveToolId)?.cursor ?? 'default');

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-neutral-950 text-neutral-100 select-none">
      <Header
        ctx={ctx}
        zoomPercent={zoomPercent}
        canUndo={canUndo}
        canRedo={canRedo}
        saveStatus={saveStatus}
        onFit={fitView}
        onZoomStep={zoomStep}
      />
      <div className="flex min-h-0 flex-1">
        <Toolbar ctx={ctx} activeToolId={activeToolId} />
        {/* Ruler frame: fixed 20px gutters; strips repaint content on camera
            change but NEVER move in layout (see components/ruler.tsx). */}
        <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[20px_minmax(0,1fr)] grid-rows-[20px_minmax(0,1fr)]">
          <RulerCorner />
          <RulerStrip
            orientation="horizontal"
            camera={camera}
            lengthPx={canvasSize.w}
            guidesEnabled={showGuides}
            onGuidePointerDown={(e) => guideDrag.startCreate('horizontal', e)}
          />
          <RulerStrip
            orientation="vertical"
            camera={camera}
            lengthPx={canvasSize.h}
            guidesEnabled={showGuides}
            onGuidePointerDown={(e) => guideDrag.startCreate('vertical', e)}
          />
          <CanvasViewport
            containerRef={containerRef}
            canvasRef={canvasRef}
            cursor={cursor}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onPointerLeave={onPointerLeave}
            onDoubleClick={onDoubleClick}
          />
        </div>
        <Sidebar
          ctx={ctx}
          doc={doc}
          selectedIds={selectedIds}
          selectedLayer={selectedLayer}
          activeToolId={activeToolId}
          showOutsidePanel={showOutsidePanel}
          onShowOutsidePanelChange={setShowOutsidePanel}
          showGuides={showGuides}
          onShowGuidesChange={setShowGuides}
        />
      </div>
      <DialogHost ctx={commandCtx} />
      <ToastContainer />
      <DropImport ctx={ctx} />
    </div>
  );
}
