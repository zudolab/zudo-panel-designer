// Decision 2.4's artwork-only statement, word-for-word as DECISIONS.md pins it.
//
// It lives in its own dependency-free module because BOTH consumers need it and
// they have opposite loading requirements:
//
//   - `zip.ts` embeds it in README.txt — that module pulls in the writer and
//     fflate, and is deliberately behind `await import(...)`.
//   - `download.tsx` shows it in the confirm gate BEFORE the export runs —
//     which must not drag that pipeline into the main chunk, and must not wait
//     on a dynamic import just to render a string.
//
// Keeping the constant here satisfies both: the statement is statically
// importable and free, while the pipeline stays lazy.
export const GERBER_ARTWORK_ONLY_STATEMENT =
  'This export contains artwork only — copper, solder mask, silkscreen, and the board outline. It contains no drill file and no mounting-hole geometry. It is artwork for an already-specified Takazudo blank panel, not a standalone orderable board.';
