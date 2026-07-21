// @vitest-environment jsdom
//
// analyzeSvg() needs a real DOMParser (see extract-shapes.test.ts), and this
// dialog's preview canvas needs a real <canvas> element to attach a ref to —
// hence jsdom, same per-file pragma as trace.test.tsx. jsdom's
// canvas.getContext('2d') always returns null (no real 2D context, see
// trace-pipeline.ts's imageToImageData), which is exactly what proves the
// preview's null-context guard without any extra mocking for most tests; one
// test below spies on getContext explicitly to make that guard assertion
// unmissable.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Pt } from '@zpd/core';
import { PALETTE } from '@zpd/core';
import './svg-import';
// The real OKLab-distance matcher the dialog seeds mapping rows with — see
// nearest-palette-color.test.ts for its own coverage; this file only needs
// to assert the dialog seeds AGAINST it, not re-verify its distance math.
import { nearestPaletteIndex } from '../nearest-palette-color';
import { DialogHost } from '../components/dialog-host';
import { closeDialog, getDialog, openDialog } from '../registry/dialogs';
import { importImageFile } from '../import-image';
import { toastError, toastSuccess } from '../registry/toasts';
import type { CommandContext } from '../commands';
import type { ToolContext } from '../types';

vi.mock('../import-image', () => ({ importImageFile: vi.fn() }));
vi.mock('../registry/toasts', () => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
}));

afterEach(() => {
  closeDialog();
  cleanup();
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
    beginGesture: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    select: vi.fn(),
    selectIds: vi.fn(),
    setCamera: vi.fn(),
    setActiveTool: vi.fn(),
    requestRepaint: vi.fn(),
    openDialog: vi.fn(),
    closeDialog: vi.fn(),
    ...overrides,
  } as unknown as ToolContext;
}

// The dialog contract routeImportFile() opens with: a display name, the
// decoded text, and the ORIGINAL File the text was decoded from (the image
// fallback reads its raw bytes — see the encoding test below).
function dialogProps(fileName: string, svgText: string, file?: File) {
  return {
    fileName,
    svgText,
    file: file ?? new File([svgText], fileName, { type: 'image/svg+xml' }),
  };
}

function svg(inner: string, rootAttrs = 'viewBox="0 0 100 100"'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" ${rootAttrs}>${inner}</svg>`;
}

const OK_SVG = svg('<path d="M0 0 L10 0 L10 10 Z" fill="#ff0000"/>');
const OK_SVG_DIFFERENT_COLOR = svg('<path d="M0 0 L10 0 L10 10 Z" fill="#00ff00"/>');
// A stroke-only horizontal line: an open contour whose points share one y,
// so its point-only bbox has zero height (see extract-shapes.test.ts for the
// fill="none" stroke-only shape convention).
const HORIZONTAL_LINE_SVG = svg(
  '<path d="M0 10 L100 10" fill="none" stroke="#ff0000" stroke-width="10"/>',
);
// Fails the safety gate before extraction even runs (parse-svg-document.ts) —
// an analysis-fatal state.
const ANALYSIS_FATAL_SVG = `<!DOCTYPE svg>${svg('<path d="M0 0 L10 0 L10 10 Z"/>')}`;
// Parses fine (status 'ok') but the opacity="0" subtree is skipped with a
// warning, leaving zero shapes — analysis succeeds, the trial build then
// fails with the 'no-shapes' fatal. This is the builder-fatal state.
const BUILDER_FATAL_SVG = svg('<g opacity="0"><path d="M0 0 L10 0 L10 10 Z"/></g>');

describe('svg-import dialog', () => {
  it('registers itself under id "svg-import"', () => {
    expect(getDialog('svg-import')).toBeDefined();
  });

  it('ok state: shows the editable-shape count, a seeded mapping row, and an enabled import button', () => {
    const ctx = stubCtx();
    const Dialog = getDialog('svg-import')!.component;
    render(<Dialog props={dialogProps('icon.svg', OK_SVG)} close={vi.fn()} ctx={ctx} />);

    expect(screen.getByText('icon.svg')).toBeTruthy();
    expect(screen.getByText('1 editable shapes')).toBeTruthy();

    const paletteHexes = PALETTE.map((entry) => entry.hex);
    const expectedIndex = nearestPaletteIndex('#ff0000', paletteHexes);
    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'color for #ff0000' });
    expect(Number(select.value)).toBe(expectedIndex);

    const importButton = screen.getByRole<HTMLButtonElement>('button', { name: 'Import 1 shape' });
    expect(importButton.disabled).toBe(false);
    expect(screen.queryByText('Import as image instead')).toBeNull();
  });

  it('color mapping list is height-capped and scrollable, not unbounded (codex finding)', () => {
    // The extractor allows up to MAX_COLORS-1 source colors — an unbounded
    // list would grow the modal past shorter viewports and clip the Import
    // button, since DialogHost's dialog wrapper has no scroll of its own
    // (see pattern-picker.tsx for the established "cap the list" pattern).
    // jsdom doesn't lay out real scrollbars, so this asserts the CSS
    // contract (max-height + overflow-y-auto) rather than pixel overflow.
    const ctx = stubCtx();
    const Dialog = getDialog('svg-import')!.component;
    render(<Dialog props={dialogProps('icon.svg', OK_SVG)} close={vi.fn()} ctx={ctx} />);

    const list = screen.getByTestId('color-mapping-list');
    expect(list.className).toContain('overflow-y-auto');
    expect(list.className).toMatch(/max-h-/);
  });

  it('ok state: never mounts SVG markup, only a <canvas> — guards a null 2D context without crashing', () => {
    const ctx = stubCtx();
    const Dialog = getDialog('svg-import')!.component;
    const { container } = render(
      <Dialog props={dialogProps('icon.svg', OK_SVG)} close={vi.fn()} ctx={ctx} />,
    );

    expect(container.querySelector('canvas')).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toContain('<svg');
  });

  it('re-seeds mappings when the dialog input is replaced while still open', () => {
    // DialogHost reuses the same component instance across a same-id
    // openDialog('svg-import', …) replacement (e.g. a second SVG dropped
    // before Cancel/Import). Without re-seeding on props.svgText change, the
    // mapping keyed to the first file's colors would fail buildPathLayers'
    // exact-coverage check against the second file's colors and incorrectly
    // fall back to the fatal state.
    const ctx = stubCtx();
    const Dialog = getDialog('svg-import')!.component;
    const { rerender } = render(
      <Dialog props={dialogProps('a.svg', OK_SVG)} close={vi.fn()} ctx={ctx} />,
    );
    expect(screen.getByRole('combobox', { name: 'color for #ff0000' })).toBeTruthy();

    rerender(
      <Dialog props={dialogProps('b.svg', OK_SVG_DIFFERENT_COLOR)} close={vi.fn()} ctx={ctx} />,
    );

    expect(screen.getByText('1 editable shapes')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'color for #00ff00' })).toBeTruthy();
    expect(screen.queryByText('Import as image instead')).toBeNull();
  });

  it('preview: a stroke-only horizontal/vertical line still gets a nonzero fitting box, not a blank preview', () => {
    // jsdom has no Path2D (buildPath2D always returns null here, see the
    // file header), so fill()/stroke() never fire in this environment either
    // way -- what this test proves is that the degenerate-bbox guard does
    // NOT bail out before context.scale(), which it did prior to the
    // stroke-width margin fix (a point-only bbox for a horizontal line has
    // zero height).
    const scaleCalls: unknown[] = [];
    const fakeContext = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn((...args: unknown[]) => scaleCalls.push(args)),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
    };
    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(fakeContext as unknown as CanvasRenderingContext2D);
    const ctx = stubCtx();
    const Dialog = getDialog('svg-import')!.component;
    render(
      <Dialog props={dialogProps('line.svg', HORIZONTAL_LINE_SVG)} close={vi.fn()} ctx={ctx} />,
    );

    expect(scaleCalls.length).toBeGreaterThan(0);
    getContextSpy.mockRestore();
  });

  it('explicitly exercises the preview draw guard when getContext returns null', () => {
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const ctx = stubCtx();
    const Dialog = getDialog('svg-import')!.component;

    expect(() =>
      render(<Dialog props={dialogProps('icon.svg', OK_SVG)} close={vi.fn()} ctx={ctx} />),
    ).not.toThrow();
    expect(getContextSpy).toHaveBeenCalled();
    getContextSpy.mockRestore();
  });

  it('analysis-fatal state: shows the fallback explanation and only the image-import action', () => {
    const ctx = stubCtx();
    const Dialog = getDialog('svg-import')!.component;
    render(<Dialog props={dialogProps('bad.svg', ANALYSIS_FATAL_SVG)} close={vi.fn()} ctx={ctx} />);

    expect(screen.getByText(/import as an image instead/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import as image instead' })).toBeTruthy();
    expect(screen.queryByText(/^Import \d+ shape/)).toBeNull();
  });

  it('builder-fatal state: a zero-shape ok analysis lands in the same fallback UI as an analysis fatal', () => {
    const ctx = stubCtx();
    const Dialog = getDialog('svg-import')!.component;
    render(
      <Dialog props={dialogProps('empty.svg', BUILDER_FATAL_SVG)} close={vi.fn()} ctx={ctx} />,
    );

    expect(screen.getByText(/import as an image instead/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import as image instead' })).toBeTruthy();
    expect(screen.queryByText(/^Import \d+ shape/)).toBeNull();
    // The builder's own fatal (not part of analysis.diagnostics) still shows
    // up in the diagnostics panel.
    expect(screen.getByText(/no-shapes/)).toBeTruthy();
  });

  it('import: commits once, selects every new layer id, toasts success, and closes', () => {
    const ctx = stubCtx();
    const close = vi.fn();
    const Dialog = getDialog('svg-import')!.component;
    render(<Dialog props={dialogProps('icon.svg', OK_SVG)} close={close} ctx={ctx} />);

    fireEvent.click(screen.getByRole('button', { name: 'Import 1 shape' }));

    expect(ctx.commit).toHaveBeenCalledTimes(1);
    const committed = vi.mocked(ctx.commit).mock.calls[0][0];
    expect(committed.layers).toHaveLength(1);
    expect(ctx.selectIds).toHaveBeenCalledTimes(1);
    expect(ctx.selectIds).toHaveBeenCalledWith(committed.layers.map((l) => l.id));
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('import as image instead: reconstructs the file, routes through importImageFile, and closes', () => {
    vi.mocked(importImageFile).mockResolvedValue();
    const ctx = stubCtx();
    const close = vi.fn();
    const Dialog = getDialog('svg-import')!.component;
    render(<Dialog props={dialogProps('bad.svg', ANALYSIS_FATAL_SVG)} close={close} ctx={ctx} />);

    fireEvent.click(screen.getByRole('button', { name: 'Import as image instead' }));

    expect(importImageFile).toHaveBeenCalledTimes(1);
    const [file, passedCtx] = vi.mocked(importImageFile).mock.calls[0];
    expect(file.name).toBe('bad.svg');
    expect(file.type).toBe('image/svg+xml');
    expect(passedCtx).toBe(ctx);
    expect(close).toHaveBeenCalledTimes(1);
  });

  // REGRESSION (codex review): routeImportFile's file.text() always decodes as
  // UTF-8, so an SVG stored in another XML-supported encoding (UTF-16 here)
  // reaches this dialog as mojibake. Rebuilding the fallback File from that
  // string corrupted the raster path too — and such files imported fine before
  // native SVG import existed, so losing both paths is a regression, not a gap.
  it('import as image instead: carries the ORIGINAL bytes, not a UTF-8 re-encoding of the decoded text', () => {
    vi.mocked(importImageFile).mockResolvedValue();
    // "<svg/>" in UTF-16LE, with a byte-order mark.
    const utf16Bytes = new Uint8Array([
      0xff, 0xfe, 0x3c, 0x00, 0x73, 0x00, 0x76, 0x00, 0x67, 0x00, 0x2f, 0x00, 0x3e, 0x00,
    ]);
    const original = new File([utf16Bytes], 'utf16.svg', { type: 'image/svg+xml' });
    const mojibake = new TextDecoder().decode(utf16Bytes); // what file.text() yields
    const ctx = stubCtx();
    const Dialog = getDialog('svg-import')!.component;
    render(
      <Dialog props={dialogProps('utf16.svg', mojibake, original)} close={vi.fn()} ctx={ctx} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Import as image instead' }));

    expect(importImageFile).toHaveBeenCalledTimes(1);
    const [passed] = vi.mocked(importImageFile).mock.calls[0];
    expect(passed.size).toBe(original.size);
    // Re-encoding the mojibake as UTF-8 changes the byte length — that is the
    // exact corruption this guards against.
    expect(passed.size).not.toBe(new File([mojibake], 'utf16.svg').size);
    expect(passed.name).toBe('utf16.svg');
    expect(passed.type).toBe('image/svg+xml');
  });

  it('import as image instead: a decode/read failure surfaces via the error toast', async () => {
    vi.mocked(importImageFile).mockRejectedValue(new Error('could not decode'));
    const ctx = stubCtx();
    const Dialog = getDialog('svg-import')!.component;
    render(<Dialog props={dialogProps('bad.svg', ANALYSIS_FATAL_SVG)} close={vi.fn()} ctx={ctx} />);

    fireEvent.click(screen.getByRole('button', { name: 'Import as image instead' }));
    await vi.waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(vi.mocked(toastError).mock.calls[0][0]).toBe('Could not import image');
  });

  it('Cancel takes initial focus', () => {
    const ctx = stubCtx();
    render(<DialogHost ctx={ctx as CommandContext} />);

    act(() => openDialog('svg-import', dialogProps('icon.svg', OK_SVG)));

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('is named through DialogHost', () => {
    const ctx = stubCtx();
    render(<DialogHost ctx={ctx as CommandContext} />);

    act(() => openDialog('svg-import', dialogProps('icon.svg', OK_SVG)));

    expect(screen.getByRole('dialog', { name: 'Import SVG' })).toBeTruthy();
  });
});
