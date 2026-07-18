// Google Font loading is split into two independently memoized resources:
// one stylesheet per family, and one FontFaceSet.load attempt per exact
// (family, sampleText).  Keeping the latter exact is important for fonts with
// unicode-range subsets: a Latin layer and a Japanese layer can share the CSS
// while still requesting different binary faces.

export type FontInitialResult = 'ready' | 'failed' | 'timed-out';
export type FontAttemptStatus = 'pending' | 'ready' | 'failed' | 'timed-out' | 'late-ready';

export interface FontLoadAttempt {
  /** Stable, never-rejecting initial wait (including the 10 second timeout). */
  readonly initial: Promise<FontInitialResult>;
  /** Compatibility wait used by ensureFont/loadGoogleFont. Never rejects. */
  readonly done: Promise<void>;
  getStatus(): FontAttemptStatus;
  /** Fires only for timed-out -> late-ready, and at most once per callback. */
  onLateReady(callback: () => void): () => void;
}

const stylesheetPromises = new Map<string, Promise<void>>();
const attemptsByFamily = new Map<string, Map<string | undefined, FontLoadAttempt>>();
const attemptedFamilies = new Set<string>();

export const FONT_LOAD_TIMEOUT_MS = 10000;

function ensureStylesheet(family: string): Promise<void> {
  const existing = stylesheetPromises.get(family);
  if (existing) return existing;

  if (typeof document === 'undefined') {
    const unavailable = Promise.resolve();
    stylesheetPromises.set(family, unavailable);
    return unavailable;
  }

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}&display=swap`;
  const promise = new Promise<void>((resolve) => {
    // A stylesheet failure is not allowed to reject callers. FontFaceSet.load
    // still gets a chance because the face may already be registered/cached.
    link.onload = () => resolve();
    link.onerror = () => resolve();
  });
  stylesheetPromises.set(family, promise);
  document.head.appendChild(link);
  return promise;
}

function createAttempt(family: string, sampleText: string | undefined): FontLoadAttempt {
  let status: FontAttemptStatus = 'pending';
  let settleInitial: (result: FontInitialResult) => void = () => {};
  const lateReadyCallbacks = new Set<() => void>();
  const initial = new Promise<FontInitialResult>((resolve) => {
    settleInitial = resolve;
  });
  const done = initial.then(() => {});

  const settle = (result: FontInitialResult) => {
    if (status !== 'pending') return;
    status = result;
    if (result !== 'timed-out') lateReadyCallbacks.clear();
    attemptedFamilies.add(family);
    settleInitial(result);
  };

  const timeoutId = setTimeout(() => settle('timed-out'), FONT_LOAD_TIMEOUT_MS);
  const fontSet = typeof document === 'undefined' ? undefined : document.fonts;

  if (!fontSet?.load) {
    clearTimeout(timeoutId);
    // Still register the family stylesheet when a document exists, but do not
    // dim or retry forever in runtimes without FontFaceSet (notably jsdom).
    void ensureStylesheet(family);
    settle('failed');
  } else {
    // This promise remains observed after timeout. A late success is useful:
    // geometry can perform one final accurate measure/repaint. A late failure
    // deliberately changes nothing and emits nothing.
    ensureStylesheet(family)
      .then(() => fontSet.load(`16px "${family}"`, sampleText))
      .then(
        () => {
          if (status === 'pending') {
            clearTimeout(timeoutId);
            settle('ready');
          } else if (status === 'timed-out') {
            status = 'late-ready';
            for (const callback of [...lateReadyCallbacks]) callback();
            lateReadyCallbacks.clear();
          }
        },
        () => {
          if (status === 'pending') {
            clearTimeout(timeoutId);
            settle('failed');
          }
        },
      );
  }

  return {
    initial,
    done,
    getStatus: () => status,
    onLateReady(callback) {
      // Registration after the transition does not replay it: callers inspect
      // getStatus() first and can measure immediately when it is late-ready.
      if (status !== 'pending' && status !== 'timed-out') return () => {};
      lateReadyCallbacks.add(callback);
      return () => lateReadyCallbacks.delete(callback);
    },
  };
}

export function ensureGoogleFontAttempt(family: string, sampleText?: string): FontLoadAttempt {
  let samples = attemptsByFamily.get(family);
  if (!samples) {
    samples = new Map();
    attemptsByFamily.set(family, samples);
  }
  const existing = samples.get(sampleText);
  if (existing) return existing;
  const attempt = createAttempt(family, sampleText);
  samples.set(sampleText, attempt);
  return attempt;
}

export function getGoogleFontAttemptStatus(
  family: string,
  sampleText?: string,
): FontAttemptStatus | 'idle' {
  return attemptsByFamily.get(family)?.get(sampleText)?.getStatus() ?? 'idle';
}

// Family-level readiness is retained for the Font Explorer. Here "loaded"
// means the initial attempt is over (ready, failed, or timed out), matching the
// old no-retry contract; exact rendering state comes from the attempt above.
export function isGoogleFontLoaded(family: string): boolean {
  return attemptedFamilies.has(family);
}

export function loadGoogleFont(family: string, sampleText?: string): Promise<void> {
  return ensureGoogleFontAttempt(family, sampleText).done;
}
