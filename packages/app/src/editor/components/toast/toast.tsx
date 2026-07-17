// Single toast notification. Auto-dismisses after a per-variant duration
// (success 3000ms / warning 6000ms / error never), pauses while hovered, and
// is keyboard-dismissible (close button + Escape while focused).
import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type { ToastVariant } from '../../registry/toasts';

export interface ToastProps {
  id: string;
  variant: ToastVariant;
  message: string;
  description?: string;
  /**
   * Override the auto-dismiss duration in ms. When omitted, defaults are:
   *   - success: 3000 ms
   *   - warning: 6000 ms
   *   - error:   no auto-dismiss — the user must dismiss explicitly via the
   *              close button, by clicking the toast, or by pressing Esc
   *              while the toast has focus.
   * Pass `Infinity` to disable auto-dismiss for any variant.
   */
  duration?: number;
  onDismiss: (id: string) => void;
}

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  success: 'border-emerald-700/60 bg-emerald-950/90 text-emerald-200',
  error: 'border-red-700/60 bg-red-950/90 text-red-200',
  warning: 'border-amber-700/60 bg-amber-950/90 text-amber-200',
};

export function Toast({ id, variant, message, description, duration, onDismiss }: ToastProps) {
  const defaultDuration: number =
    variant === 'success' ? 3000 : variant === 'warning' ? 6000 : Infinity;
  const effectiveDuration = duration ?? defaultDuration;
  const autoDismissEnabled = Number.isFinite(effectiveDuration);

  // Track remaining time for pause-on-hover.
  const remainingRef = useRef<number>(effectiveDuration);
  const startRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const scheduleTimer = (ms: number) => {
    clearTimer();
    if (!Number.isFinite(ms)) return;
    startRef.current = Date.now();
    timerRef.current = setTimeout(() => {
      onDismiss(id);
    }, ms);
  };

  // Start the auto-dismiss timer on mount (only when finite duration).
  useEffect(() => {
    if (autoDismissEnabled) {
      scheduleTimer(remainingRef.current);
    }
    return () => {
      clearTimer();
    };
    // Mount-only: the timer is driven imperatively by the hover handlers
    // below, not by prop changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMouseEnter = () => {
    if (!autoDismissEnabled) return;
    if (startRef.current !== null) {
      const elapsed = Date.now() - startRef.current;
      remainingRef.current = Math.max(0, remainingRef.current - elapsed);
      startRef.current = null;
    }
    clearTimer();
  };

  const handleMouseLeave = () => {
    if (!autoDismissEnabled) return;
    scheduleTimer(remainingRef.current);
  };

  const dismiss = () => {
    clearTimer();
    onDismiss(id);
  };

  // Click anywhere on the toast (outside the close button) dismisses it. The
  // close button handles its own click and stops propagation so it doesn't
  // double-dismiss.
  const handleClick = () => {
    dismiss();
  };

  const handleCloseClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    dismiss();
  };

  // Esc dismisses the focused toast. Listening on the toast element (rather
  // than document) keeps the shortcut scoped so it never steals Esc from a
  // parent dialog.
  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      dismiss();
    }
  };

  // a11y: role="status" (polite) for success/warning, role="alert"
  // (assertive) for error.
  const role = variant === 'error' ? 'alert' : 'status';
  const ariaLive = variant === 'error' ? 'assertive' : 'polite';

  return (
    <div
      className={`pointer-events-auto flex min-w-60 max-w-[420px] cursor-pointer items-start gap-3 rounded-md border px-4 py-3 shadow-lg backdrop-blur-sm transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current ${VARIANT_CLASSES[variant]}`}
      role={role}
      aria-live={ariaLive}
      aria-atomic="true"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium leading-snug">{message}</span>
        {description && (
          <span className="break-words text-xs leading-snug opacity-80">{description}</span>
        )}
      </div>
      <button
        type="button"
        className="flex h-6 w-6 flex-none items-center justify-center rounded text-base leading-none opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
        aria-label="Dismiss notification"
        onClick={handleCloseClick}
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
