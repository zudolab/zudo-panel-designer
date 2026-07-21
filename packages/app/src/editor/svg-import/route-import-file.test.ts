// Routing-logic tests for the shared SVG/raster/other dispatch (#141): every
// entry point (drop, picker, paste) funnels through routeImportFile() so
// classification -> action stays in exactly one place (the "exact same code
// path" property from #75). classifyImportFile and importImageFile are
// mocked so this file proves ONLY the routing decisions — classifyImportFile
// has its own behavioral tests (classify-file.test.ts) and importImageFile
// has its own (../import-image.test.ts).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyImportFile } from './classify-file';
import { importImageFile } from '../import-image';
import { routeImportFile } from './route-import-file';
import { toastError, toastWarning } from '../registry/toasts';
import type { ToolContext } from '../types';

vi.mock('./classify-file', () => ({ classifyImportFile: vi.fn() }));
vi.mock('../import-image', () => ({ importImageFile: vi.fn() }));
vi.mock('../registry/toasts', () => ({ toastError: vi.fn(), toastWarning: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
});

function stubCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return { openDialog: vi.fn(), ...overrides } as unknown as ToolContext;
}

describe('routeImportFile — svg', () => {
  it('reads the file text and opens the svg-import dialog with the fixed dialog contract', async () => {
    vi.mocked(classifyImportFile).mockResolvedValue('svg');
    const ctx = stubCtx();
    const file = new File(['<svg></svg>'], 'icon.svg', { type: 'image/svg+xml' });

    await routeImportFile(file, ctx);

    expect(ctx.openDialog).toHaveBeenCalledWith('svg-import', {
      fileName: 'icon.svg',
      svgText: '<svg></svg>',
    });
    expect(importImageFile).not.toHaveBeenCalled();
  });

  it('falls back to "clipboard.svg" for an unnamed file (pasted clipboard files can be unnamed)', async () => {
    vi.mocked(classifyImportFile).mockResolvedValue('svg');
    const ctx = stubCtx();
    const file = new File(['<svg></svg>'], '', { type: 'image/svg+xml' });

    await routeImportFile(file, ctx);

    expect(ctx.openDialog).toHaveBeenCalledWith(
      'svg-import',
      expect.objectContaining({ fileName: 'clipboard.svg' }),
    );
  });

  it('toasts an error and imports nothing when file.text() rejects', async () => {
    vi.mocked(classifyImportFile).mockResolvedValue('svg');
    const ctx = stubCtx();
    const file = new File(['<svg></svg>'], 'icon.svg', { type: 'image/svg+xml' });
    vi.spyOn(file, 'text').mockRejectedValue(new Error('could not read'));

    await routeImportFile(file, ctx);

    expect(toastError).toHaveBeenCalledWith(
      'Could not read file',
      expect.objectContaining({ description: 'could not read' }),
    );
    expect(ctx.openDialog).not.toHaveBeenCalled();
    expect(importImageFile).not.toHaveBeenCalled();
  });
});

describe('routeImportFile — raster', () => {
  it('imports via importImageFile with no notice for a normally-named raster file', async () => {
    vi.mocked(classifyImportFile).mockResolvedValue('raster');
    vi.mocked(importImageFile).mockResolvedValue(undefined);
    const ctx = stubCtx();
    const file = new File(['bytes'], 'photo.png', { type: 'image/png' });

    await routeImportFile(file, ctx);

    expect(importImageFile).toHaveBeenCalledWith(file, ctx);
    expect(toastWarning).not.toHaveBeenCalled();
  });

  it('shows a notice when a .svg-named file turned out to be raster (misleading filename)', async () => {
    vi.mocked(classifyImportFile).mockResolvedValue('raster');
    vi.mocked(importImageFile).mockResolvedValue(undefined);
    const ctx = stubCtx();
    const file = new File(['\x89PNG'], 'logo.svg', { type: 'image/svg+xml' });

    await routeImportFile(file, ctx);

    expect(importImageFile).toHaveBeenCalledWith(file, ctx);
    expect(toastWarning).toHaveBeenCalledWith(
      expect.stringContaining('imported as image'),
    );
  });

  it('propagates an importImageFile rejection to the caller instead of swallowing it', async () => {
    vi.mocked(classifyImportFile).mockResolvedValue('raster');
    vi.mocked(importImageFile).mockRejectedValue(new Error('decode failed'));
    const ctx = stubCtx();
    const file = new File(['bytes'], 'photo.png', { type: 'image/png' });

    await expect(routeImportFile(file, ctx)).rejects.toThrow('decode failed');
    // The notice would be misleading if nothing actually got imported.
    expect(toastWarning).not.toHaveBeenCalled();
  });
});

describe('routeImportFile — svg-oversize', () => {
  it('imports via importImageFile and shows the oversize notice, preserving today\'s large-SVG behavior (no regression)', async () => {
    vi.mocked(classifyImportFile).mockResolvedValue('svg-oversize');
    vi.mocked(importImageFile).mockResolvedValue(undefined);
    const ctx = stubCtx();
    const file = new File(['x'.repeat(3_000_000)], 'huge.svg', { type: 'image/svg+xml' });

    await routeImportFile(file, ctx);

    expect(importImageFile).toHaveBeenCalledWith(file, ctx);
    expect(toastWarning).toHaveBeenCalledWith(
      expect.stringContaining('imported as image'),
    );
  });

  it('propagates an importImageFile rejection instead of swallowing it', async () => {
    vi.mocked(classifyImportFile).mockResolvedValue('svg-oversize');
    vi.mocked(importImageFile).mockRejectedValue(new Error('decode failed'));
    const ctx = stubCtx();
    const file = new File(['x'.repeat(3_000_000)], 'huge.svg', { type: 'image/svg+xml' });

    await expect(routeImportFile(file, ctx)).rejects.toThrow('decode failed');
    expect(toastWarning).not.toHaveBeenCalled();
  });
});

describe('routeImportFile — other', () => {
  it('toasts the unsupported-file error and imports nothing', async () => {
    vi.mocked(classifyImportFile).mockResolvedValue('other');
    const ctx = stubCtx();
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });

    await routeImportFile(file, ctx);

    expect(toastError).toHaveBeenCalledWith('Unsupported file', expect.any(Object));
    expect(importImageFile).not.toHaveBeenCalled();
    expect(ctx.openDialog).not.toHaveBeenCalled();
  });
});
