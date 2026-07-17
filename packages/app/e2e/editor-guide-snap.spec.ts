// Guide-snapping smoke coverage (#55): the select tool's move gesture snaps
// to a document guide within catch range once one exists in the doc — #53's
// layered "grid first, guides win ties" rule, wired into select.tsx's move
// gesture here. State is asserted through the window.__zpdTest bridge
// (read-only — see helpers.ts / test-bridge.ts), never by pixel-probing.
//
// DEPENDENCY (#54, a sibling PR against the same base/editor-select-and-view
// branch): creating a guide is a ruler-drag gesture that #54 has not landed
// in THIS worktree yet — packages/app/src/editor/components/ruler.tsx here
// is still the static #33 strip with no pointer handlers at all (no
// onPointerDown/drag), so there is no UI path to get a guide into the doc.
// The read-only test-bridge (test-bridge.ts) is explicitly non-mutating, so
// it cannot substitute either. This test is written against the CONVENTIONAL
// ruler-guide gesture (drag down from the top/horizontal ruler, testid
// `ruler-h`, to drop a VERTICAL guide — an x-position line, Illustrator/
// Photoshop/Figma's convention, matching this repo's Guide doc comment in
// core/types.ts: "'vertical' is a vertical line at x = position"), but it
// has NOT been run against a live build — there's nothing to run it
// against in this worktree. `test.fixme` so it's tracked but does not
// execute or fail CI. Once #54 merges: drop `.fixme`, and adjust the ruler
// interaction below to match #54's actual implementation (testids, drag
// mechanics, and exact drop-to-guide-position mapping may differ from the
// assumptions here).
import { expect, test } from '@playwright/test';
import { bridge, openEditor, toScreenPoint } from './helpers';

test.fixme(
  '@smoke dragging a layer near a guide snaps it onto the guide (#53 + #55)',
  async ({ page }) => {
    await openEditor(page);

    // demo-rect (demo-doc.ts): x 8..32 / y 14..30. Drop a vertical guide a
    // few mm past its right edge (32) so a rightward drag can catch it.
    const guideDropXMm = 40;
    const rulerH = page.getByTestId('ruler-h');
    const rulerBox = await rulerH.boundingBox();
    if (!rulerBox) throw new Error('ruler-h not visible');
    const dropStart = await toScreenPoint(page, { x: guideDropXMm, y: 0 });
    await page.mouse.move(dropStart.x, rulerBox.y + rulerBox.height / 2);
    await page.mouse.down();
    const dropEnd = await toScreenPoint(page, { x: guideDropXMm, y: 20 });
    await page.mouse.move(dropEnd.x, dropEnd.y, { steps: 5 });
    await page.mouse.up();

    const afterDrop = await bridge(page).getDoc();
    const guide = afterDrop.guides.find((g) => g.orientation === 'vertical');
    expect(guide, 'ruler drag should have created a vertical guide').toBeTruthy();
    const guidePos = guide!.position;

    // Drag demo-rect so its right edge approaches the guide from a few mm
    // short — inside the select tool's catch radius once close enough —
    // and assert the right edge lands EXACTLY on the guide's real position
    // (read back above, not hardcoded — the drop may not land on exactly
    // guideDropXMm).
    const from = await toScreenPoint(page, { x: 20, y: 22 }); // inside demo-rect
    const nudge = guidePos - 32 + 1; // 1mm short of an exact grid landing
    const to = await toScreenPoint(page, { x: 20 + nudge, y: 22 });
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.up();

    const doc = await bridge(page).getDoc();
    const rect = doc.layers.find((l) => l.id === 'demo-rect');
    if (rect?.type !== 'shape') throw new Error('demo-rect missing or wrong type');
    expect(rect.x + rect.width).toBeCloseTo(guidePos, 6);
  },
);
