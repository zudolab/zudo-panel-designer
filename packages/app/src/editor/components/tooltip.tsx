// Desktop-only hover/focus tooltip primitive. Ported from
// $HOME/repos/zp/pgen/packages/pattern-gen-viewer/src/components/shared/tooltip.tsx
// (dependency-free floating label used by the reference composer). Five
// behaviors carried over from that port:
//
// 1. Touch is ignored (`pointerType === 'touch'`) — a tap-triggered flash
//    tooltip is worse than none, matching Figma/tldraw/Excalidraw. No
//    long-press fallback.
// 2. A disabled/aria-disabled child is wrapped in an inert
//    `pointer-events: auto` span, because Safari fires no pointer/focus
//    events on a disabled <button>.
// 3. The floating element is portaled to document.body so it escapes any
//    overflow:hidden ancestor (e.g. the canvas viewport).
// 4. Smart-flip: position is computed from getBoundingClientRect() against
//    window.innerWidth/innerHeight; the preferred side flips to its opposite
//    when it would overflow, then the cross axis is clamped.
// 5. While open, position is recomputed on window resize/scroll (capture,
//    passive), coalesced through requestAnimationFrame.
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { createPortal } from 'react-dom';
import { Z_INDEX } from '../z-index';

// Gap between trigger edge and tooltip edge (px, fixed by design).
const GAP = 6;
// Minimum viewport margin to keep the tooltip on-screen (px).
const VIEWPORT_MARGIN = 8;
const TOOLTIP_Z_INDEX = Z_INDEX.tooltip;

export type TooltipPlacement = 'top' | 'right' | 'bottom' | 'left';

export interface TooltipProps {
  /** Text or rich content shown inside the tooltip bubble. */
  content: ReactNode;
  /**
   * Preferred placement relative to the trigger. Physical sides only — RTL
   * is out of scope. Smart-flip falls back to the opposite side if the
   * preferred side would overflow the viewport.
   */
  placement?: TooltipPlacement;
  /** Delay in ms before the tooltip appears on hover. Default 300ms. */
  delay?: number;
  /** When true the tooltip is fully suppressed (no hover, no focus trigger). */
  disabled?: boolean;
  /** The trigger element. Must be a single React element. */
  children: ReactElement;
}

interface Position {
  top: number;
  left: number;
}

// Assigns a DOM node to two refs at once. Lives outside the component so the
// mutation happens across a function-call boundary rather than inline in
// render — inline ref-merging trips the react-compiler eslint rules'
// (`react-hooks/immutability`, `react-hooks/refs`) static heuristics, which
// can't verify a manually-composed ref callback only ever runs at commit
// time, not during render.
function mergeRefs<T>(a: { current: T | null }, b: Ref<T> | undefined): (node: T | null) => void {
  return (node) => {
    a.current = node;
    if (typeof b === 'function') {
      b(node);
    } else if (b && typeof b === 'object') {
      (b as { current: T | null }).current = node;
    }
  };
}

// Calls the child's own handler (if any) before Tooltip's own, instead of
// cloneElement silently replacing it.
function composeHandlers<E>(theirs: unknown, ours: (e: E) => void): (e: E) => void {
  return (e: E) => {
    if (typeof theirs === 'function') {
      (theirs as (e: E) => void)(e);
    }
    ours(e);
  };
}

function opposite(p: TooltipPlacement): TooltipPlacement {
  if (p === 'top') return 'bottom';
  if (p === 'bottom') return 'top';
  if (p === 'left') return 'right';
  return 'left';
}

function computePosition(
  triggerRect: DOMRect,
  tooltipWidth: number,
  tooltipHeight: number,
  preferredPlacement: TooltipPlacement,
): Position & { actualPlacement: TooltipPlacement } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  function posForPlacement(p: TooltipPlacement): Position {
    switch (p) {
      case 'top':
        return {
          top: triggerRect.top - tooltipHeight - GAP,
          left: triggerRect.left + triggerRect.width / 2 - tooltipWidth / 2,
        };
      case 'bottom':
        return {
          top: triggerRect.bottom + GAP,
          left: triggerRect.left + triggerRect.width / 2 - tooltipWidth / 2,
        };
      case 'left':
        return {
          top: triggerRect.top + triggerRect.height / 2 - tooltipHeight / 2,
          left: triggerRect.left - tooltipWidth - GAP,
        };
      case 'right':
        return {
          top: triggerRect.top + triggerRect.height / 2 - tooltipHeight / 2,
          left: triggerRect.right + GAP,
        };
    }
  }

  function overflows(p: TooltipPlacement, pos: Position): boolean {
    switch (p) {
      case 'top':
        return pos.top < VIEWPORT_MARGIN;
      case 'bottom':
        return pos.top + tooltipHeight > vh - VIEWPORT_MARGIN;
      case 'left':
        return pos.left < VIEWPORT_MARGIN;
      case 'right':
        return pos.left + tooltipWidth > vw - VIEWPORT_MARGIN;
    }
  }

  let placement = preferredPlacement;
  let pos = posForPlacement(placement);

  if (overflows(placement, pos)) {
    const flipped = opposite(placement);
    const flippedPos = posForPlacement(flipped);
    // Prefer the flipped side unless it also overflows (stay put then).
    if (!overflows(flipped, flippedPos)) {
      placement = flipped;
      pos = flippedPos;
    }
  }

  // Clamp the cross axis to the viewport margins.
  if (placement === 'top' || placement === 'bottom') {
    pos.left = Math.max(VIEWPORT_MARGIN, Math.min(pos.left, vw - tooltipWidth - VIEWPORT_MARGIN));
  } else {
    pos.top = Math.max(VIEWPORT_MARGIN, Math.min(pos.top, vh - tooltipHeight - VIEWPORT_MARGIN));
  }

  return { top: pos.top, left: pos.left, actualPlacement: placement };
}

export function Tooltip({
  content,
  placement = 'top',
  delay = 300,
  disabled = false,
  children,
}: TooltipProps) {
  const tooltipId = useId();
  const triggerRef = useRef<Element | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);

  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<
    (Position & { actualPlacement: TooltipPlacement }) | null
  >(null);

  const clearShowTimer = useCallback(() => {
    if (showTimerRef.current !== null) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
  }, []);

  const cancelRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    const tooltip = tooltipRef.current;
    if (!trigger || !tooltip) return;

    const triggerRect = trigger.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    setPosition(
      computePosition(
        triggerRect,
        tooltipRect.width || 160, // fallback size before first paint
        tooltipRect.height || 28,
        placement,
      ),
    );
  }, [placement]);

  const repositionRaf = useCallback(() => {
    cancelRaf();
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      reposition();
    });
  }, [cancelRaf, reposition]);

  const show = useCallback(() => {
    if (disabled) return;
    clearShowTimer();
    showTimerRef.current = setTimeout(() => {
      showTimerRef.current = null;
      reposition();
      setVisible(true);
    }, delay);
  }, [disabled, clearShowTimer, reposition, delay]);

  const hide = useCallback(() => {
    clearShowTimer();
    setVisible(false);
  }, [clearShowTimer]);

  // Reposition on resize/scroll while open. Capture-phase scroll catches
  // intermediate scrollable ancestors without enumerating them.
  useEffect(() => {
    if (!visible) return;

    window.addEventListener('resize', repositionRaf, { passive: true });
    window.addEventListener('scroll', repositionRaf, { passive: true, capture: true });

    return () => {
      window.removeEventListener('resize', repositionRaf);
      window.removeEventListener('scroll', repositionRaf, {
        capture: true,
      } as EventListenerOptions);
    };
  }, [visible, repositionRaf]);

  useEffect(() => {
    return () => {
      clearShowTimer();
      cancelRaf();
    };
  }, [clearShowTimer, cancelRaf]);

  if (!isValidElement(children)) {
    throw new Error('Tooltip: children must be a single React element.');
  }

  const childProps = children.props as Record<string, unknown>;
  const isDisabledControl = childProps.disabled === true || childProps['aria-disabled'] === 'true';
  const tooltipIdAttr = `tooltip-${tooltipId.replace(/:/g, '')}`;

  // Pointer events (not mouse events) because `pointerType` only exists on
  // PointerEvent — a touch tap's compatibility mouseenter/mouseover is a
  // plain MouseEvent with no pointerType at all, so checking it there would
  // never actually catch touch.
  const onPointerEnterOwn = (e: ReactPointerEvent) => {
    if (e.pointerType === 'touch') return;
    show();
  };
  const onPointerLeaveOwn = () => {
    hide();
  };
  const onFocusOwn = (e: ReactFocusEvent) => {
    // Skip focus moving between elements inside our own subtree.
    const related = e.relatedTarget as Node | null;
    const wrapper = triggerRef.current;
    if (related && wrapper && wrapper.contains(related)) return;
    show();
  };
  const onBlurOwn = (e: ReactFocusEvent) => {
    const related = e.relatedTarget as Node | null;
    const wrapper = triggerRef.current;
    if (related && wrapper && wrapper.contains(related)) return;
    hide();
  };

  let triggerElement: ReactNode;

  if (isDisabledControl) {
    // Disabled-button wrapper: Safari doesn't reliably fire pointer/focus
    // events on a disabled control, so relay through a neutral span instead.
    // The span is new (not cloned from the child), so there's no existing
    // handler or aria-describedby on it to preserve.
    triggerElement = (
      <span
        ref={triggerRef as Ref<HTMLSpanElement>}
        style={{ display: 'inline-flex', pointerEvents: 'auto' } as CSSProperties}
        onPointerEnter={onPointerEnterOwn}
        onPointerLeave={onPointerLeaveOwn}
        onFocus={onFocusOwn}
        onBlur={onBlurOwn}
        aria-describedby={visible ? tooltipIdAttr : undefined}
      >
        {children}
      </span>
    );
  } else {
    // React 19 passes `ref` as a regular prop; fall back to the legacy
    // `element.ref` field so this works either side of the 18 → 19 boundary.
    const childRef =
      (childProps as { ref?: Ref<unknown> }).ref ?? (children as { ref?: Ref<unknown> }).ref;

    // Compose with (not overwrite) any handlers the child already carries,
    // and merge (not replace) any existing aria-describedby.
    const existingDescribedBy = childProps['aria-describedby'] as string | undefined;

    // react-hooks/refs flags each of the following as "may read a ref during
    // render" — it can't see that these callbacks only touch `.current`
    // once React invokes them later (at commit/event time), not during this
    // assignment. Known false positive for ref-composition helpers; see
    // mergeRefs above for the same limitation.
    // eslint-disable-next-line react-hooks/refs
    const composedRef = mergeRefs(triggerRef, childRef);
    // eslint-disable-next-line react-hooks/refs
    const composedPointerEnter = composeHandlers(childProps.onPointerEnter, onPointerEnterOwn);
    // eslint-disable-next-line react-hooks/refs
    const composedPointerLeave = composeHandlers(childProps.onPointerLeave, onPointerLeaveOwn);
    // eslint-disable-next-line react-hooks/refs
    const composedFocus = composeHandlers(childProps.onFocus, onFocusOwn);
    // eslint-disable-next-line react-hooks/refs
    const composedBlur = composeHandlers(childProps.onBlur, onBlurOwn);

    triggerElement = cloneElement(children, {
      ref: composedRef,
      onPointerEnter: composedPointerEnter,
      onPointerLeave: composedPointerLeave,
      onFocus: composedFocus,
      onBlur: composedBlur,
      'aria-describedby': visible
        ? [existingDescribedBy, tooltipIdAttr].filter(Boolean).join(' ')
        : existingDescribedBy,
    } as Record<string, unknown>);
  }

  const tooltipStyle: CSSProperties = position
    ? { top: position.top, left: position.left, zIndex: TOOLTIP_Z_INDEX }
    : { top: -9999, left: -9999, zIndex: TOOLTIP_Z_INDEX };

  return (
    <>
      {triggerElement}
      {!disabled &&
        createPortal(
          <div
            ref={tooltipRef}
            id={tooltipIdAttr}
            role="tooltip"
            aria-hidden={!visible}
            className={`pointer-events-none fixed rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs whitespace-nowrap text-neutral-100 shadow transition-opacity duration-150 ${
              visible ? 'opacity-100' : 'opacity-0'
            }`}
            style={tooltipStyle}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
