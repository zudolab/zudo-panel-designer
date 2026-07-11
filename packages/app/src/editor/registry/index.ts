// Auto-discovery entry point. Eagerly importing every file under the four
// extension folders runs each file's register*() side effect exactly once.
// This is what makes the extension model conflict-free: a Wave-5 tool is a NEW
// file in ../tools/ — it is picked up here with ZERO edits to any existing
// file. Do NOT replace these globs with a hand-maintained import list.
//
// import.meta.glob is a Vite/Vitest primitive; the eager form inlines static
// imports at build time, so tree-shaking and HMR still work normally.
const modules = {
  ...import.meta.glob('../tools/*.{ts,tsx}', { eager: true }),
  ...import.meta.glob('../inspectors/*.{ts,tsx}', { eager: true }),
  ...import.meta.glob('../add-actions/*.{ts,tsx}', { eager: true }),
  ...import.meta.glob('../dialogs/*.{ts,tsx}', { eager: true }),
};

// The count is only meaningful as a smoke signal that discovery ran; the
// registries themselves are the source of truth for what was found.
export const DISCOVERED_MODULE_COUNT = Object.keys(modules).length;

export {
  allTools,
  getTool,
  registerTool,
  toolByShortcut,
  unregisterTool,
} from './tools';
export { getInspector, registerInspector, unregisterInspector } from './inspectors';
export { allAddActions, registerAddAction, unregisterAddAction } from './add-actions';
export {
  closeDialog,
  getDialog,
  getOpenDialog,
  openDialog,
  registerDialog,
  subscribeDialog,
  unregisterDialog,
} from './dialogs';
