// Wave-5 (#12) pattern picker — a grid of pattern thumbnails. Opened two ways:
//  - inspectors/pattern.tsx "Browse…" passes { layerId }: clicking a card
//    swaps that layer's patternType and resets its params to the new
//    pattern's defaults.
//  - add-actions/add-pattern.ts "Add pattern…" opens with no props: clicking
//    a card adds a brand-new pattern layer on top and selects it.
// Either path is a single commit() — one undo entry — then closes.
//
// #87: the registry grows from 12 to 62 patterns across this epic, so the
// dialog needs a search box and paged/sentinel lazy rendering — the same
// conventions as the font-explorer dialog (search auto-focus on open, one
// IntersectionObserver on a tail sentinel loading the next page). Per-card
// content-visibility / per-card observers are deliberately not used here:
// CSS visibility does not stop React's useLayoutEffect canvas draws below,
// and the paged/sentinel approach is simpler to test.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { mintId, type PatternLayer } from '@zpd/core';
import {
  defaultParams,
  PATTERN_GENERATORS,
  renderPatternThumb,
  type PanelPatternGenerator,
} from '@zpd/patterns';
import { registerDialog } from '../registry/dialogs';
import type { DialogProps } from '../types';

export interface PatternPickerProps {
  layerId?: string;
}

// CSS px per thumbnail; renderPatternThumb scales the backing store for the
// device's devicePixelRatio internally.
export const THUMBNAIL_SIZE_PX = 96;

// Cards rendered before the sentinel takes over — mirrors font-explorer's
// PAGE_SIZE convention.
export const PAGE_SIZE = 24;

export interface PatternFilterInput {
  search: string;
}

// Pure filter, extracted so the search matching is unit-testable without
// rendering the grid. Matches `name` (the stable kebab id) or `displayName`,
// case-insensitively.
export function filterPatterns(
  source: PanelPatternGenerator[],
  { search }: PatternFilterInput,
): PanelPatternGenerator[] {
  if (!search) return source;
  const query = search.toLowerCase();
  return source.filter(
    (gen) =>
      gen.name.toLowerCase().includes(query) || gen.displayName.toLowerCase().includes(query),
  );
}

function PatternCard({ gen, onPick }: { gen: PanelPatternGenerator; onPick: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // useLayoutEffect (not useEffect) so the thumbnail is sized+drawn before the
  // browser's first paint — otherwise the canvas shows its default 300x150 box
  // for one frame and the grid visibly jumps. The inline style width/height
  // pins the CSS box to its final size even before this runs.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderPatternThumb(canvas, gen, THUMBNAIL_SIZE_PX);
  }, [gen]);

  return (
    <button
      type="button"
      onClick={onPick}
      title={gen.displayName}
      className="flex flex-col items-center gap-1.5 rounded border border-neutral-700 bg-neutral-800 p-2 hover:border-sky-400 hover:bg-neutral-700"
    >
      <canvas
        ref={canvasRef}
        className="rounded"
        style={{ width: THUMBNAIL_SIZE_PX, height: THUMBNAIL_SIZE_PX }}
      />
      <span className="w-full truncate text-center text-[11px] text-neutral-300">
        {gen.displayName}
      </span>
    </button>
  );
}

function PatternPickerDialog({ props, close, ctx }: DialogProps<PatternPickerProps>) {
  const [search, setSearch] = useState('');
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Auto-focus the search input on open — same convention as font-explorer:
  // a child layout effect runs before the host's generic first-focusable
  // fallback (dialog-host.tsx), so the search field wins even if a later
  // element (e.g. Close) precedes it in DOM order.
  useLayoutEffect(() => {
    searchRef.current?.focus();
  }, []);

  const filtered = useMemo(() => filterPatterns(PATTERN_GENERATORS, { search }), [search]);

  // Reset paging to the first page when the search filter changes, using
  // React's "adjust state during render" pattern rather than a
  // setState-in-effect — same as font-explorer.
  const [prevSearch, setPrevSearch] = useState(search);
  if (search !== prevSearch) {
    setPrevSearch(search);
    setDisplayCount(PAGE_SIZE);
  }

  // Scrolling the results region back to the top on a filter change is a DOM
  // side effect (no state), so it stays in an effect — same as font-explorer.
  // Without this, a search typed after scrolling several pages down leaves
  // the shortened grid's scrollTop unchanged, which can immediately
  // intersect the sentinel and undo the paging reset above.
  useEffect(() => {
    if (scrollRoot && typeof scrollRoot.scrollTo === 'function') {
      scrollRoot.scrollTo(0, 0);
    }
  }, [search, scrollRoot]);

  const displayed = filtered.slice(0, displayCount);
  const hasMore = displayCount < filtered.length;

  // Infinite scroll: one page at a time as the sentinel nears the viewport of
  // the dialog's own scroll region. Same approach as font-explorer.
  useEffect(() => {
    if (!hasMore) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        // Unobserve on hit and recreate via the displayCount dep, so the next
        // page still triggers even when the sentinel stays within rootMargin
        // after the grid grows.
        observer.unobserve(sentinel);
        setDisplayCount((previous) => Math.min(previous + PAGE_SIZE, filtered.length));
      },
      { root: scrollRoot, rootMargin: '200px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, filtered.length, displayCount, scrollRoot]);

  function handlePick(gen: PanelPatternGenerator): void {
    if (props.layerId) {
      const layerId = props.layerId;
      const nextLayers = ctx.doc.layers.map((l) =>
        l.id === layerId && l.type === 'pattern'
          ? { ...l, patternType: gen.name, params: defaultParams(gen.name) }
          : l,
      );
      ctx.commit({ ...ctx.doc, layers: nextLayers });
    } else {
      const layer: PatternLayer = {
        id: mintId('pattern'),
        name: gen.displayName,
        type: 'pattern',
        patternType: gen.name,
        color: 1,
        params: defaultParams(gen.name),
      };
      ctx.commit({ ...ctx.doc, layers: [...ctx.doc.layers, layer] });
      ctx.select(layer.id);
    }
    close();
  }

  return (
    <div className="w-[min(640px,92vw)]">
      <h2 id="pattern-picker-title" className="mb-3 text-sm font-semibold text-neutral-100">
        Choose a pattern
      </h2>
      <label className="sr-only" htmlFor="pattern-picker-search">
        Search patterns
      </label>
      <input
        id="pattern-picker-search"
        ref={searchRef}
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search patterns…"
        className="mb-3 w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-neutral-100 placeholder:text-neutral-500"
      />
      <div
        ref={setScrollRoot}
        data-testid="pattern-picker-scroll-root"
        className="max-h-[60vh] overflow-y-auto pr-1"
      >
        {filtered.length === 0 ? (
          <div className="grid h-24 place-items-center text-sm text-neutral-500">
            No patterns match your search.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3">
              {displayed.map((gen) => (
                <PatternCard key={gen.name} gen={gen} onPick={() => handlePick(gen)} />
              ))}
            </div>
            {hasMore && (
              <div
                ref={sentinelRef}
                className="h-4"
                aria-hidden="true"
                data-testid="pattern-picker-sentinel"
              />
            )}
          </>
        )}
      </div>
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

registerDialog<PatternPickerProps>({
  id: 'pattern-picker',
  component: PatternPickerDialog,
  labelledBy: 'pattern-picker-title',
});
