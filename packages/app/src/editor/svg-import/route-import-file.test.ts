// Routing-logic tests for the shared SVG/raster/other dispatch (#141): every
// entry point (drop, picker, paste) funnels through routeImportFile() so
// classification -> action stays in exactly one place (the "exact same code
// path" property from #75). classifyImportFile and importImageFile are
// mocked so this file proves ONLY the routing decisions — classifyImportFile
// has its own behavioral tests (classify-file.test.ts) and importImageFile
// has its own (../import-image.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyImportFile, sniffedRasterMimeType } from './classify-file';
import { importImageFile } from '../import-image';
import { routeImportFile } from './route-import-file';
import { toastError, toastWarning } from '../registry/toasts';
import type { ToolContext } from '../types';

vi.mock('./classify-file', () => ({
  classifyImportFile: vi.fn(),
  // Defaults to "the claimed type was already right" so every existing
  // routing test below keeps asserting importImageFile was called with the
  // SAME File instance it started with -- only the dedicated raster-type
  // correction tests override this.
  sniffedRasterMimeType: vi.fn().mockResolvedValue(null),
}));
vi.mock('../import-image', () => ({ importImageFile: vi.fn() }));
vi.mock('../registry/toasts', () => ({ toastError: vi.fn(), toastWarning: vi.fn() }));

beforeEach(() => {
  // clearAllMocks (below) resets call history but not a mockResolvedValue
  // override -- re-pin the "claimed type was already right" default per test
  // so the raster-type-correction tests (which override it) can't leak into
  // whichever test happens to run after them.
  vi.mocked(sniffedRasterMimeType).mockResolvedValue(null);
});

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
      file,
    });
    expect(importImageFile).not.toHaveBeenCalled();
  });

  // REGRESSION (codex review): file.text() decodes as UTF-8 unconditionally, so
  // an SVG in another XML-supported encoding (UTF-16, ...) is mojibake by the
  // time the dialog sees svgText. The dialog's "import as image instead"
  // fallback needs the untouched bytes to stay usable, so the ORIGINAL File --
  // not a re-encoding of svgText -- has to travel with the dialog props.
  it('passes the original File instance through so the image fallback can use the raw bytes', async () => {
    vi.mocked(classifyImportFile).mockResolvedValue('svg');
    const ctx = stubCtx();
    const file = new File(['<svg></svg>'], 'icon.svg', { type: 'image/svg+xml' });

    await routeImportFile(file, ctx);

    const [, props] = vi.mocked(ctx.openDialog).mock.calls[0] as [string, { file: File }];
    expect(props.file).toBe(file);
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
    expect(toastWarning).toHaveBeenCalledWith(expect.stringContaining('imported as image'));
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

  // #143: a File's .type in the browser is name/extension-derived, not
  // content-sniffed, so a PNG mislabeled "logo.svg" still carries
  // type: "image/svg+xml" here -- importImageFile's readAsDataURL would bake
  // that straight into the data URL, and an <img> given that MIME tries to
  // XML-parse the raster bytes and fails outright (confirmed against a real
  // browser in svg-import.spec.ts). routeImportFile must correct the type
  // before handing the file to importImageFile.
  it("corrects a misleading raster file's type before importing", async () => {
    vi.mocked(classifyImportFile).mockResolvedValue('raster');
    vi.mocked(sniffedRasterMimeType).mockResolvedValue('image/png');
    vi.mocked(importImageFile).mockResolvedValue(undefined);
    const ctx = stubCtx();
    const file = new File(['\x89PNG'], 'logo.svg', { type: 'image/svg+xml' });

    await routeImportFile(file, ctx);

    expect(importImageFile).toHaveBeenCalledTimes(1);
    const [importedFile] = vi.mocked(importImageFile).mock.calls[0]!;
    expect(importedFile).not.toBe(file); // a corrected copy, not the original
    expect(importedFile.type).toBe('image/png');
    expect(importedFile.name).toBe('logo.svg');
  });

  it('imports the original File instance unchanged when its claimed type already matches the sniffed bytes', async () => {
    vi.mocked(classifyImportFile).mockResolvedValue('raster');
    vi.mocked(sniffedRasterMimeType).mockResolvedValue('image/png');
    vi.mocked(importImageFile).mockResolvedValue(undefined);
    const ctx = stubCtx();
    const file = new File(['bytes'], 'photo.png', { type: 'image/png' });

    await routeImportFile(file, ctx);

    expect(importImageFile).toHaveBeenCalledWith(file, ctx);
  });
});

describe('routeImportFile — svg-oversize', () => {
  it("imports via importImageFile and shows the oversize notice, preserving today's large-SVG behavior (no regression)", async () => {
    vi.mocked(classifyImportFile).mockResolvedValue('svg-oversize');
    vi.mocked(importImageFile).mockResolvedValue(undefined);
    const ctx = stubCtx();
    const file = new File(['x'.repeat(3_000_000)], 'huge.svg', { type: 'image/svg+xml' });

    await routeImportFile(file, ctx);

    expect(importImageFile).toHaveBeenCalledWith(file, ctx);
    expect(toastWarning).toHaveBeenCalledWith(expect.stringContaining('imported as image'));
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
