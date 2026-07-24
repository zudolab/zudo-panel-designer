// "Show content outside the panel" (issue #43): a sidebar "View" toggle,
// default ON, that ghost-paints off-panel layer content at ~35% alpha. Real
// trusted input only (page.mouse / page.keyboard) — synthetic dispatchEvent
// is unreliable against React's event delegation (see editor-core.spec.ts).
// This is a canvas pixel-probe test, not a bridge-state test: the toggle only
// changes what gets PAINTED, not any document state, so window.__zpdTest
// (read-only, doc/camera/selection only) can't observe it — only the pixel
// data can.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PANEL_HEIGHT_MM, panelWidthMm } from '@zpd/core';
import { expect, type Page, test } from '@playwright/test';
import {
  bridge,
  countPixelsDiffering,
  importPanelJson,
  openEditor,
  readCanvasRegion,
  toScreenPoint,
} from './helpers';

// Matches renderer.ts's WORKSPACE_BG ('#26282c').
const BACKGROUND_RGB: [number, number, number] = [38, 40, 44];
// Comfortably above canvas anti-aliasing/shadow-blur noise, comfortably below
// the ~60-unit-per-channel delta a real ghosted fill produces (see below).
const COLOR_TOLERANCE = 8;

// Reads a single device pixel from the real canvas element at a page-viewport
// point (the same coordinate space page.mouse and toScreenPoint() use) — not
// a screenshot diff, so it's exact and fast. getBoundingClientRect() +
// devicePixelRatio are read live inside the page to stay correct regardless
// of the canvas's backing-store scale.
async function readCanvasPixel(
  page: Page,
  screenPt: { x: number; y: number },
): Promise<[number, number, number, number]> {
  return page.evaluate(({ x, y }) => {
    const canvas = document.querySelector(
      '[data-testid="editor-canvas"]',
    ) as HTMLCanvasElement | null;
    if (!canvas) throw new Error('editor-canvas not found');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const px = Math.round((x - rect.left) * dpr);
    const py = Math.round((y - rect.top) * dpr);
    const data = ctx.getImageData(px, py, 1, 1).data;
    return [data[0], data[1], data[2], data[3]];
  }, screenPt);
}

function expectMatchesBackground(rgba: [number, number, number, number]) {
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(rgba[i] - BACKGROUND_RGB[i])).toBeLessThanOrEqual(COLOR_TOLERANCE);
  }
}

function expectDiffersFromBackground(rgba: [number, number, number, number]) {
  const differs = BACKGROUND_RGB.some((c, i) => Math.abs(rgba[i] - c) > COLOR_TOLERANCE);
  expect(differs).toBe(true);
}

test('@smoke show-outside-panel toggle ghosts off-panel shapes and the pattern square (bounded by the square)', async ({
  page,
}) => {
  await openEditor(page);

  const panelHp = await bridge(page).getPanelHp();
  const panelWmm = panelWidthMm(panelHp);

  // #97 flipped the ghost pass's pattern rule: the default cover square hangs
  // off-panel on both x sides, so its off-panel margin now GHOSTS (dimmed dot
  // grid) — but never past the square's own edge, generator overscan or not.
  // Region scans, not single pixels: dot-grid paint has gaps (see helpers.ts).
  const pattern = (await bridge(page).getMaterialLayers()).find((l) => l.type === 'pattern');
  if (pattern?.type !== 'pattern') throw new Error('expected the default pattern layer');
  const midY = PANEL_HEIGHT_MM / 2;
  // Inside the square, left of the panel; -9mm ≈ -39px at the fitted zoom, so
  // the region clears the panel's drop-shadow blur (renderer.ts: shadowBlur
  // 24). 7mm wide > the 5mm dot pitch, so ghost dots are guaranteed inside.
  const inSquareGutter = [
    await toScreenPoint(page, { x: -16, y: midY - 5 }),
    await toScreenPoint(page, { x: -9, y: midY + 5 }),
  ] as const;
  // Beyond the square's left edge — must stay pure workspace background in
  // every state (the square clip bounds the generators' edge overscan).
  const beyondSquare = [
    await toScreenPoint(page, { x: pattern.x - 12, y: midY - 5 }),
    await toScreenPoint(page, { x: pattern.x - 5, y: midY + 5 }),
  ] as const;
  const ghostCount = async (
    region: readonly [{ x: number; y: number }, { x: number; y: number }],
  ) =>
    countPixelsDiffering(
      await readCanvasRegion(page, region[0], region[1]),
      BACKGROUND_RGB,
      COLOR_TOLERANCE,
    );

  // Default ON, before any interaction: the square's off-panel margin ghosts
  // from the very first paint; past the square stays background.
  expect(await ghostCount(inSquareGutter)).toBeGreaterThan(0);
  expect(await ghostCount(beyondSquare)).toBe(0);

  // Add a rect, then drag it fully past the panel's right edge so its whole
  // body is off-panel — a deterministic, easy-to-probe "shape spills off the
  // panel" case (a partial drag would work too; full keeps the probe simple).
  await page.getByLabel('Add rectangle').click();
  const rectId = await bridge(page).getSelectedId();
  expect(rectId).not.toBeNull();
  const rectBefore = await bridge(page).getMaterialLayer(rectId!);
  if (rectBefore?.type !== 'shape') throw new Error('expected a shape layer to be selected');

  const dragStart = await toScreenPoint(page, {
    x: rectBefore.x + rectBefore.width / 2,
    y: rectBefore.y + rectBefore.height / 2,
  });
  const dragEndMmX = panelWmm + rectBefore.width; // guarantees the whole rect clears the panel
  const dragEnd = await toScreenPoint(page, {
    x: dragEndMmX,
    y: rectBefore.y + rectBefore.height / 2,
  });
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.mouse.down();
  await page.mouse.move(dragEnd.x, dragEnd.y, { steps: 8 });
  await page.mouse.up();

  const rectAfter = await bridge(page).getMaterialLayer(rectId!);
  if (rectAfter?.type !== 'shape') throw new Error('rect layer disappeared during drag');
  expect(rectAfter.x).toBeGreaterThan(panelWmm); // sanity: fully off-panel now

  const shapeMm = { x: rectAfter.x + rectAfter.width / 2, y: rectAfter.y + rectAfter.height / 2 };
  const shapePt = await toScreenPoint(page, shapeMm);

  // 1. ON (default): the off-panel shape pixel differs from the workspace
  //    background — it's the rect's gold fill ghosted at ~35% alpha.
  expectDiffersFromBackground(await readCanvasPixel(page, shapePt));

  // In-panel double-composite guard (#97): capture an on-panel region (dot
  // grid + demo layers) while the ghost pass is ON — after toggling OFF it
  // must be byte-identical, proving the even-odd outer clip keeps the ghost
  // pass fully disjoint from the panel-clipped pass (no pixel painted twice).
  const inPanel = [
    await toScreenPoint(page, { x: 10, y: 60 }),
    await toScreenPoint(page, { x: 20, y: 70 }),
  ] as const;
  const inPanelOn = await readCanvasRegion(page, inPanel[0], inPanel[1]);

  // Toggle OFF via real trusted input — the checkbox is the only sidebar
  // control under this label (CollapsibleSection "View").
  await page.getByLabel('Show content outside the panel').click();

  // 2. OFF: rendering is byte-identical to today — that same pixel matches
  //    the workspace background exactly, and the ghosted square margin
  //    disappears too (#97: ghost-toggle-off hides the pattern ghost).
  expectMatchesBackground(await readCanvasPixel(page, shapePt));
  expect(await ghostCount(inSquareGutter)).toBe(0);

  // 3. In-panel pixels never changed — ghost pass ON vs OFF is disjoint.
  const inPanelOff = await readCanvasRegion(page, inPanel[0], inPanel[1]);
  expect(inPanelOff.data).toEqual(inPanelOn.data);

  // 4. Past the square's edge stays background in BOTH states.
  expect(await ghostCount(beyondSquare)).toBe(0);
});

// --- inverted solder-mask compositing (#179, epic #176) ----------------------
//
// Real-browser pixel probes of the NEGATIVE mask semantics: the panel is
// fully mask-covered by default; shapes in the solder-mask container punch
// openings revealing copper (or bare substrate) beneath. The fixture doc
// (fixtures/mask-inversion.json) lays out deterministic mm geometry:
//   copper pad    4..28 × 4..24
//   mask punch    8..48 × 8..20  (spans copper AND bare substrate)
//   copper image  40..52 × 100..112 (solid red SVG — a design-aid overlay)
// ESM package ("type": "module") — no CJS __dirname during Playwright's
// module evaluation; derive it like the neighboring fixture-based specs.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MASK_INVERSION_FIXTURE = path.join(__dirname, 'fixtures', 'mask-inversion.json');

// Renderer/palette constants (core palette.ts + PCB_SUBSTRATE).
const GOLD_RGB: [number, number, number] = [212, 175, 55]; // PALETTE[1] '#d4af37'
const SUBSTRATE_RGB: [number, number, number] = [168, 148, 106]; // PCB_SUBSTRATE '#a8946a'
const MASK_RGB: [number, number, number] = [21, 21, 21]; // PALETTE[0] '#151515'
const IMAGE_RGB: [number, number, number] = [255, 0, 0]; // fixture SVG fill

// Polls until the device pixel at an mm point settles on `rgb` — repaints are
// async (image decode, font settle), so a one-shot read would race them.
async function expectPixelAtMm(
  page: Page,
  mm: { x: number; y: number },
  rgb: readonly [number, number, number],
) {
  await expect
    .poll(
      async () => {
        const rgba = await readCanvasPixel(page, await toScreenPoint(page, mm));
        return rgb.every((c, i) => Math.abs(rgba[i] - c) <= COLOR_TOLERANCE);
      },
      { message: `pixel at mm (${mm.x}, ${mm.y}) should be rgb(${rgb.join(',')})` },
    )
    .toBe(true);
}

test('inverted mask compositing: openings reveal copper/substrate, coverage stays black, images overlay (#179)', async ({
  page,
}) => {
  await openEditor(page);
  await importPanelJson(page, MASK_INVERSION_FIXTURE);

  // Opening over copper ⇒ exposed copper gold.
  await expectPixelAtMm(page, { x: 14, y: 14 }, GOLD_RGB);
  // Opening over nothing ⇒ bare FR4 substrate.
  await expectPixelAtMm(page, { x: 38, y: 14 }, SUBSTRATE_RGB);
  // Un-punched copper ⇒ mask black (the sheet covers in-z-order copper).
  await expectPixelAtMm(page, { x: 14, y: 22 }, MASK_RGB);
  // Un-punched empty area ⇒ mask black.
  await expectPixelAtMm(page, { x: 38, y: 40 }, MASK_RGB);
  // Image in the COPPER container still visible on top of the full sheet
  // (images never punch and render as the final overlay).
  await expectPixelAtMm(page, { x: 46, y: 106 }, IMAGE_RGB);

  // Hidden mask container ⇒ NO sheet: bare copper on substrate everywhere.
  await page.getByLabel('Hide Solder mask').click();
  await expectPixelAtMm(page, { x: 14, y: 14 }, GOLD_RGB);
  await expectPixelAtMm(page, { x: 14, y: 22 }, GOLD_RGB);
  await expectPixelAtMm(page, { x: 38, y: 14 }, SUBSTRATE_RGB);
  await expectPixelAtMm(page, { x: 38, y: 40 }, SUBSTRATE_RGB);
  await expectPixelAtMm(page, { x: 46, y: 106 }, IMAGE_RGB);
});
