// Tier-2 font picker: the Google Fonts Explorer dialog (issue #71). Opened
// from the text inspector's "Browse Google Fonts…" button with { layerId };
// clicking a card commits that family onto the layer (one undo entry) and
// closes. Registered via the dialog registry and rendered inside the
// host-owned modal shell (dialog-host.tsx supplies the backdrop, focus trap,
// Escape-to-close) — this component supplies content only.
//
// Ported from pgen's font-explorer-modal.tsx, adapted to zpd's Tailwind dark
// chrome and dialog contract. Deliberately dropped in the port: the D1/auth
// favorites (now localStorage, see use-font-favorites.ts) and the Composer
// hover-preview/commit session (its own source marks it optional — click to
// commit is the supported path).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TextLayer } from '@zpd/core';
import { registerDialog } from '../registry/dialogs';
import { ensureFont, isFontLoaded } from '../fonts';
import { loadGoogleFont } from '../google-font-loader';
import { useFontFavorites } from '../use-font-favorites';
import { Tooltip } from '../components/tooltip';
import catalogData from '../data/google-fonts-catalog.json';
import type { GoogleFontEntry, FontCategory } from '../data/google-fonts-types';
import { FONT_CATEGORIES, CATEGORY_LABELS } from '../data/google-fonts-types';
import type { DialogProps } from '../types';

const catalog = catalogData as GoogleFontEntry[];

export const PAGE_SIZE = 60;

// Preview strings. Japanese fonts are pointless to preview with Latin pangram
// text (their Latin glyphs are an afterthought), so selecting the Japanese
// category swaps the default sample to a short Japanese greeting.
const DEFAULT_PREVIEW_TEXT = 'The quick brown fox';
const JAPANESE_PREVIEW_TEXT = 'こんにちは日本語';

// Delay before a still-loading card shows its spinner. A font already in cache
// resolves well under this, so fast loads never flash a spinner (issue #71's
// "non-flickering loading state").
const SPINNER_DELAY_MS = 200;

export interface FontExplorerProps {
  /** The text layer the picked family is committed onto. */
  layerId?: string;
}

export interface FontFilterInput {
  search: string;
  category: FontCategory | null;
  favorites: ReadonlySet<string>;
}

// Pure filter + favorites-first ordering, extracted so the search/category/
// Japanese/favorites logic is unit-testable without rendering the grid.
// Japanese is derived from the catalog's own `subsets` bucket, not a
// hand-maintained family list.
export function filterFonts(
  source: GoogleFontEntry[],
  { search, category, favorites }: FontFilterInput,
): GoogleFontEntry[] {
  let result = source;
  if (category === 'japanese') {
    result = result.filter((font) => font.subsets.includes('japanese'));
  } else if (category) {
    result = result.filter((font) => font.category === category);
  }
  if (search) {
    const query = search.toLowerCase();
    result = result.filter((font) => font.family.toLowerCase().includes(query));
  }
  if (favorites.size > 0) {
    const favoriteFonts = result.filter((font) => favorites.has(font.family));
    const otherFonts = result.filter((font) => !favorites.has(font.family));
    result = [...favoriteFonts, ...otherFonts];
  }
  return result;
}

function FontExplorerDialog({ props, close, ctx }: DialogProps<FontExplorerProps>) {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<FontCategory | null>(null);
  // null = follow the category's auto sample; a string = the user's own text
  // (which then sticks across category changes).
  const [customPreviewText, setCustomPreviewText] = useState<string | null>(null);
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const { isFavorite, toggleFavorite, favorites } = useFontFavorites();

  // Derived, not effect-synced: the sample auto-switches to Japanese with the
  // category until the user types their own text. Deriving in render keeps it
  // off the setState-in-effect path.
  const previewText =
    customPreviewText ??
    (activeCategory === 'japanese' ? JAPANESE_PREVIEW_TEXT : DEFAULT_PREVIEW_TEXT);

  const activeFamily = useMemo(() => {
    const layer = ctx.doc.layers.find((l) => l.id === props.layerId);
    return layer && layer.type === 'text' ? layer.fontFamily : null;
  }, [ctx.doc, props.layerId]);

  const filtered = useMemo(
    () => filterFonts(catalog, { search, category: activeCategory, favorites }),
    [search, activeCategory, favorites],
  );

  // Reset paging to the first page when the search/category filter changes,
  // using React's "adjust state during render" pattern rather than a
  // setState-in-effect. Toggling a favorite reorders but does not reset paging.
  const filterKey = JSON.stringify([search, activeCategory ?? '']);
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setDisplayCount(PAGE_SIZE);
  }

  // Scrolling the results region back to the top on a filter change is a DOM
  // side effect (no state), so it stays in an effect.
  useEffect(() => {
    if (scrollRoot && typeof scrollRoot.scrollTo === 'function') {
      scrollRoot.scrollTo(0, 0);
    }
  }, [filterKey, scrollRoot]);

  const displayed = filtered.slice(0, displayCount);
  const hasMore = displayCount < filtered.length;

  // Infinite scroll: one page at a time as the sentinel nears the viewport of
  // the dialog's own scroll region.
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

  const applyFamily = useCallback(
    (family: string) => {
      const layerId = props.layerId;
      const layer = ctx.doc.layers.find((l) => l.id === layerId);
      if (!layer || layer.type !== 'text') {
        close();
        return;
      }
      // Clicking the already-applied family is a no-op: committing an identical
      // document would push a phantom undo entry and discard the redo branch.
      if (layer.fontFamily === family) {
        close();
        return;
      }
      const nextLayers = ctx.doc.layers.map((l) =>
        l.id === layerId && l.type === 'text' ? { ...l, fontFamily: family } : l,
      );
      ctx.commit({ ...ctx.doc, layers: nextLayers });
      // Repaint once the real face is ready — the canvas draws the fallback
      // face immediately, same contract as the inspector's direct edit. The
      // layer's own content is forwarded so a CJK font fetches the glyphs
      // actually being rendered, not just the Latin range.
      ensureFont(family, (layer as TextLayer).content).then(() => ctx.requestRepaint());
      close();
    },
    [ctx, props.layerId, close],
  );

  const countLabel =
    filtered.length === catalog.length
      ? `${catalog.length} families`
      : `${filtered.length} of ${catalog.length} families`;

  return (
    <div className="flex h-[80vh] max-h-[720px] w-[min(900px,94vw)] flex-col">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 id="font-explorer-title" className="text-sm font-semibold text-neutral-100">
            Google Fonts
          </h2>
          <p className="text-[11px] text-neutral-500">{countLabel}</p>
        </div>
        <button
          type="button"
          onClick={close}
          className="rounded border border-neutral-600 bg-neutral-700 px-3 py-1 text-xs text-neutral-100 hover:bg-neutral-600"
        >
          Close
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <label className="sr-only" htmlFor="font-explorer-search">
          Search Google Fonts
        </label>
        <input
          id="font-explorer-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search Google Fonts…"
          className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-neutral-100 placeholder:text-neutral-500"
        />
        <div className="flex flex-wrap items-center gap-1" aria-label="Font category">
          <button
            type="button"
            aria-pressed={activeCategory === null}
            onClick={() => setActiveCategory(null)}
            className={categoryBtnClass(activeCategory === null)}
          >
            All
          </button>
          {FONT_CATEGORIES.map((category) => (
            <button
              key={category}
              type="button"
              aria-pressed={activeCategory === category}
              onClick={() => setActiveCategory(activeCategory === category ? null : category)}
              className={categoryBtnClass(activeCategory === category)}
            >
              {CATEGORY_LABELS[category]}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-neutral-400">
          <span className="shrink-0">Preview</span>
          <input
            type="text"
            value={previewText}
            onChange={(e) => setCustomPreviewText(e.target.value)}
            placeholder="Type preview text…"
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-neutral-100 placeholder:text-neutral-500"
          />
        </label>
      </div>

      <div
        ref={setScrollRoot}
        className="mt-3 flex-1 overflow-y-auto rounded border border-neutral-800 bg-neutral-950/40 p-2"
      >
        {filtered.length === 0 ? (
          <div className="grid h-full place-items-center text-sm text-neutral-500">
            No fonts match your search.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
              {displayed.map((font) => (
                <FontCard
                  key={font.family}
                  font={font}
                  previewText={previewText}
                  scrollRoot={scrollRoot}
                  isActive={font.family === activeFamily}
                  isFavorite={isFavorite(font.family)}
                  onSelect={applyFamily}
                  onToggleFavorite={toggleFavorite}
                />
              ))}
            </div>
            {hasMore && (
              <div
                ref={sentinelRef}
                className="h-4"
                aria-hidden="true"
                data-testid="font-explorer-sentinel"
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function categoryBtnClass(active: boolean): string {
  return `rounded border px-2 py-0.5 text-xs ${
    active
      ? 'border-sky-400 bg-sky-500/20 text-sky-200'
      : 'border-neutral-700 bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
  }`;
}

interface FontCardProps {
  font: GoogleFontEntry;
  previewText: string;
  scrollRoot: HTMLElement | null;
  isActive: boolean;
  isFavorite: boolean;
  onSelect: (family: string) => void;
  onToggleFavorite: (family: string) => void;
}

function FontCard({
  font,
  previewText,
  scrollRoot,
  isActive,
  isFavorite,
  onSelect,
  onToggleFavorite,
}: FontCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(() => isFontLoaded(font.family));
  const [showSpinner, setShowSpinner] = useState(false);
  // Latest preview text, read inside the observer callback so editing the
  // sample never re-runs the load effect (and never re-fires the observer)
  // across every visible card. Synced via an effect, never mutated in render.
  const previewTextRef = useRef(previewText);
  useEffect(() => {
    previewTextRef.current = previewText;
  }, [previewText]);

  // Lazy per-card load: fetch the family only once its card scrolls into (or
  // near) view. The card renders its name/sample in the loaded face; until
  // then a fallback face keeps the layout stable (no reflow when it swaps).
  useEffect(() => {
    if (loaded) return;
    const element = cardRef.current;
    if (!element) return;
    let disposed = false;
    let spinnerTimer: ReturnType<typeof setTimeout> | null = null;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        observer.disconnect();
        spinnerTimer = setTimeout(() => {
          if (!disposed) setShowSpinner(true);
        }, SPINNER_DELAY_MS);
        void loadGoogleFont(font.family, previewTextRef.current).finally(() => {
          if (disposed) return;
          if (spinnerTimer !== null) clearTimeout(spinnerTimer);
          setShowSpinner(false);
          setLoaded(true);
        });
      },
      { root: scrollRoot, rootMargin: '100px' },
    );
    observer.observe(element);
    return () => {
      disposed = true;
      if (spinnerTimer !== null) clearTimeout(spinnerTimer);
      observer.disconnect();
    };
  }, [font.family, loaded, scrollRoot]);

  const previewStyle = loaded
    ? { fontFamily: `"${font.family.replace(/"/g, '\\"')}", sans-serif` }
    : undefined;

  return (
    <div
      ref={cardRef}
      className={`relative flex flex-col gap-1 rounded border p-2 ${
        isActive ? 'border-sky-400 bg-sky-500/10' : 'border-neutral-700 bg-neutral-800'
      }`}
    >
      <button
        type="button"
        onClick={() => onSelect(font.family)}
        aria-pressed={isActive}
        aria-label={`Use ${font.family}${isActive ? ' (current)' : ''}`}
        className="flex flex-col gap-1 rounded text-left hover:bg-neutral-700/40"
      >
        <span className="flex items-center justify-between gap-2 pr-6">
          <span className="truncate text-xs font-medium text-neutral-200">{font.family}</span>
          <span className="shrink-0 text-[10px] text-neutral-500">
            {CATEGORY_LABELS[font.category]}
          </span>
        </span>
        <span
          className={`min-h-[1.75rem] truncate text-lg text-neutral-100 ${loaded ? '' : 'text-neutral-500'}`}
          style={previewStyle}
        >
          {previewText || font.family}
        </span>
        {showSpinner && !loaded && (
          <span className="text-[10px] text-neutral-500" role="status">
            loading…
          </span>
        )}
      </button>
      <Tooltip content={isFavorite ? 'Remove from favorites' : 'Add to favorites'} placement="top">
        <button
          type="button"
          onClick={() => onToggleFavorite(font.family)}
          aria-pressed={isFavorite}
          aria-label={`${isFavorite ? 'Remove' : 'Add'} ${font.family} ${
            isFavorite ? 'from' : 'to'
          } favorites`}
          className={`absolute right-1 top-1 rounded px-1 text-sm leading-none ${
            isFavorite ? 'text-amber-300' : 'text-neutral-500 hover:text-neutral-300'
          }`}
        >
          {isFavorite ? '★' : '☆'}
        </button>
      </Tooltip>
    </div>
  );
}

registerDialog<FontExplorerProps>({
  id: 'font-explorer',
  component: FontExplorerDialog,
  labelledBy: 'font-explorer-title',
});
