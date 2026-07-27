// Decision 2.4's export-scope statement, word-for-word as DECISIONS.md pins it.
// (Filename kept from the original artwork-only era to avoid an import churn
// across the lazy/static boundary — the CONSTANT is renamed because "artwork
// only" retired with #231: the export ships drill data and, on FR-4,
// back-side files now.)
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
import type { PcbMaterial } from '@zpd/core';

export const GERBER_EXPORT_SCOPE_STATEMENT =
  'This export contains fabrication data for a Takazudo blank panel: copper, solder mask, silkscreen, the board outline, and Excellon drill files for the panel screw holes (FR-4 panels also carry back-side files). The copper is decorative artwork, not a functional circuit. Hole and back-side support is still landing across the material-holes epic, so drill and back-side content may be incomplete in this build.';

/** User-facing material names for the confirm gate and README.txt. */
export const PCB_MATERIAL_LABEL: Record<PcbMaterial, string> = {
  fr4: 'FR-4',
  alumi: 'aluminum',
};
