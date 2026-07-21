// Dispatch-logic tests for the shared drop/Import-JSON code path (#75).
// Dependencies (routeImportFile, replaceDoc, confirmDialog, toasts) are
// mocked so this file proves ONLY the routing/validation/confirm-gating
// decisions in import.ts — routeImportFile's own classify-then-dispatch
// logic has its own behavioral tests (svg-import/route-import-file.test.ts)
// and replaceDoc has its own (replace-doc.test.ts).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PANEL_CONFIG_VERSION, serializePanelConfig, type DocState, type Pt } from '@zpd/core';
import { confirmDialog } from './components/confirm-dialog';
import { importDroppedFile, importJsonFile, isImportableImageFile } from './import';
import { replaceDoc } from './replace-doc';
import { toastError, toastSuccess } from './registry/toasts';
import { routeImportFile } from './svg-import/route-import-file';
import type { ToolContext } from './types';

vi.mock('./svg-import/route-import-file', () => ({ routeImportFile: vi.fn() }));
vi.mock('./replace-doc', () => ({ replaceDoc: vi.fn() }));
vi.mock('./components/confirm-dialog', () => ({ confirmDialog: vi.fn() }));
vi.mock('./registry/toasts', () => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
});

function stubCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    doc: { panelHp: 12, guides: [], layers: [] },
    camera: { pxPerMm: 1, offsetX: 0, offsetY: 0 },
    panel: { widthMm: 60, heightMm: 128.5 },
    selectedIds: [],
    selectedId: null,
    selectedLayer: null,
    toMm: (p: Pt) => p,
    toScreen: (p: Pt) => p,
    commit: vi.fn(),
    replace: vi.fn(),
    reset: vi.fn(),
    beginGesture: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    select: vi.fn(),
    selectIds: vi.fn(),
    setCamera: vi.fn(),
    setActiveTool: vi.fn(),
    requestRepaint: vi.fn(),
    evictImageCache: vi.fn(),
    openDialog: vi.fn(),
    closeDialog: vi.fn(),
    ...overrides,
  } as unknown as ToolContext;
}

function jsonFile(body: unknown, name = 'panel.json'): File {
  return new File([JSON.stringify(body)], name, { type: 'application/json' });
}

describe('isImportableImageFile', () => {
  it('accepts image/* MIME types', () => {
    expect(isImportableImageFile(new File([''], 'photo.png', { type: 'image/png' }))).toBe(true);
  });

  it('accepts .svg by extension even without an image/* MIME type', () => {
    expect(isImportableImageFile(new File([''], 'icon.svg', { type: '' }))).toBe(true);
  });

  it('rejects a JSON file', () => {
    expect(isImportableImageFile(jsonFile({}))).toBe(false);
  });

  it('accepts a file with no extension and no MIME type, deferring to classifyImportFile\'s content sniff (#143)', () => {
    expect(isImportableImageFile(new File([''], 'clipboard-blob', { type: '' }))).toBe(true);
  });

  it('still rejects a .json file even with an empty MIME type (some platforms report no MIME for .json) -- codex-caught regression', () => {
    expect(isImportableImageFile(new File(['{}'], 'panel.json', { type: '' }))).toBe(false);
  });
});

describe('importDroppedFile — dispatch by type', () => {
  it('routes an image file to routeImportFile', async () => {
    const ctx = stubCtx();
    const file = new File([''], 'photo.png', { type: 'image/png' });
    vi.mocked(routeImportFile).mockResolvedValue(undefined);

    await importDroppedFile(file, ctx);

    expect(routeImportFile).toHaveBeenCalledWith(file, ctx);
    expect(confirmDialog).not.toHaveBeenCalled();
    expect(replaceDoc).not.toHaveBeenCalled();
  });

  it('toasts an error (and leaves the doc untouched) when routeImportFile rejects', async () => {
    const ctx = stubCtx();
    const file = new File([''], 'broken.png', { type: 'image/png' });
    vi.mocked(routeImportFile).mockRejectedValue(new Error('could not decode image'));

    await importDroppedFile(file, ctx);

    expect(toastError).toHaveBeenCalledWith(
      'Could not import image',
      expect.objectContaining({ description: 'could not decode image' }),
    );
    expect(replaceDoc).not.toHaveBeenCalled();
  });

  it('routes a .json file into the JSON import path', async () => {
    const ctx = stubCtx();
    const doc: DocState = { panelHp: 6, guides: [], layers: [] };
    const file = jsonFile(serializePanelConfig(doc));
    vi.mocked(confirmDialog).mockResolvedValue(true);

    await importDroppedFile(file, ctx);

    expect(replaceDoc).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith('Panel imported');
  });

  it('routes a .json file with an empty MIME type into the JSON import path, not the image path (codex-caught regression)', async () => {
    const ctx = stubCtx();
    const doc: DocState = { panelHp: 6, guides: [], layers: [] };
    const file = new File([JSON.stringify(serializePanelConfig(doc))], 'panel.json', { type: '' });
    vi.mocked(confirmDialog).mockResolvedValue(true);

    await importDroppedFile(file, ctx);

    expect(routeImportFile).not.toHaveBeenCalled();
    expect(replaceDoc).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith('Panel imported');
  });

  it('toasts "unsupported file" for a file that is neither image nor JSON', async () => {
    const ctx = stubCtx();
    const file = new File([''], 'notes.txt', { type: 'text/plain' });

    await importDroppedFile(file, ctx);

    expect(toastError).toHaveBeenCalledWith('Unsupported file', expect.any(Object));
    expect(routeImportFile).not.toHaveBeenCalled();
    expect(replaceDoc).not.toHaveBeenCalled();
  });
});

describe('importJsonFile — strict validation, confirm-gated replace', () => {
  it('imports a valid panel config after confirming, and shows a success toast', async () => {
    const ctx = stubCtx();
    const doc: DocState = { panelHp: 6, guides: [], layers: [] };
    vi.mocked(confirmDialog).mockResolvedValue(true);

    await importJsonFile(jsonFile(serializePanelConfig(doc)), ctx);

    expect(confirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Replace current panel?', danger: true }),
    );
    expect(replaceDoc).toHaveBeenCalledTimes(1);
    expect(vi.mocked(replaceDoc).mock.calls[0][0].panelHp).toBe(6);
    expect(vi.mocked(replaceDoc).mock.calls[0][1]).toBe(ctx);
    expect(toastSuccess).toHaveBeenCalledWith('Panel imported');
  });

  it('does not replace the doc when the user cancels the confirm dialog', async () => {
    const ctx = stubCtx();
    const doc: DocState = { panelHp: 6, guides: [], layers: [] };
    vi.mocked(confirmDialog).mockResolvedValue(false);

    await importJsonFile(jsonFile(serializePanelConfig(doc)), ctx);

    expect(replaceDoc).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('rejects `{}` — the lenient parser would silently accept it, tryParsePanelConfig must not', async () => {
    const ctx = stubCtx();

    await importJsonFile(jsonFile({}), ctx);

    expect(toastError).toHaveBeenCalledWith(
      'Could not import panel JSON',
      expect.objectContaining({ description: expect.any(String) }),
    );
    expect(confirmDialog).not.toHaveBeenCalled();
    expect(replaceDoc).not.toHaveBeenCalled();
  });

  it('rejects a config from a different app, with the reason in the toast', async () => {
    const ctx = stubCtx();

    await importJsonFile(jsonFile({ app: 'other-app', version: PANEL_CONFIG_VERSION, layers: [] }), ctx);

    expect(toastError).toHaveBeenCalledWith(
      'Could not import panel JSON',
      expect.objectContaining({ description: expect.stringContaining('app mismatch') }),
    );
    expect(replaceDoc).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON text without touching the doc', async () => {
    const ctx = stubCtx();
    const file = new File(['{not valid json'], 'broken.json', { type: 'application/json' });

    await importJsonFile(file, ctx);

    expect(toastError).toHaveBeenCalledWith(
      'Could not import panel JSON',
      expect.objectContaining({ description: expect.any(String) }),
    );
    expect(confirmDialog).not.toHaveBeenCalled();
    expect(replaceDoc).not.toHaveBeenCalled();
  });
});
