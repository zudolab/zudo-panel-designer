// Layer groups integration coverage (#158, confirming #146-#157). Real
// trusted input only (page.mouse / page.keyboard) — synthetic dispatchEvent
// PointerEvents are unreliable against React's event delegation, per every
// other spec in this suite. State is asserted through the window.__zpdTest
// bridge's getLayerTree() (raw tree structure), getSelectedIds(), and
// getHistory() — never by pixel-probing the canvas.
import { expect, test, type Page } from '@playwright/test';
import { bridge, MOD, openEditor, toScreenPoint } from './helpers';

// demo-doc.ts geometry: demo-rect (8,14) 24x16 -> center (20,22).
const RECT_CENTER = { x: 20, y: 22 };
// Clears the pattern cover square too (see editor-select-modifiers.spec.ts's
// EMPTY_SPACE for the same margin reasoning).
const EMPTY_SPACE = { x: -42, y: 60 };

async function click(page: Page, mm: { x: number; y: number }, modifiers: string[] = []) {
  const pt = await toScreenPoint(page, mm);
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.click(pt.x, pt.y);
  for (const key of [...modifiers].reverse()) await page.keyboard.up(key);
}

// Selects two ordinary Silkscreen leaves, ⌘G's them, and returns the minted
// group id read straight back out of getLayerTree() — never a locally
// fabricated id. Fixed material containers cannot be grouped together, so
// this deliberately uses Rect + Text from the same container.
async function groupRectAndText(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Select layer Rect' }).click();
  await page.getByRole('button', { name: 'Select layer Text' }).click({ modifiers: ['Shift'] });
  expect(await bridge(page).getSelectedIds()).toEqual(['demo-rect', 'demo-text']);

  await page.keyboard.press(`${MOD}+g`);
  const tree = await bridge(page).getLayerTree();
  const group = tree.find((n) => n.kind === 'group');
  if (!group || group.kind !== 'group') throw new Error('⌘G did not produce a group node');
  return group.id;
}

test('@smoke ⌘G groups a multi-selection into a tree shape; panel shows the tree; collapse hides rows', async ({
  page,
}) => {
  await openEditor(page);
  const historyBefore = await bridge(page).getHistory();

  const groupId = await groupRectAndText(page);

  const tree = await bridge(page).getLayerTree();
  const group = tree.find((n) => n.id === groupId);
  if (!group || group.kind !== 'group') throw new Error('group node missing from getLayerTree()');
  expect(group.children.map((c) => c.id)).toEqual(['demo-rect', 'demo-text']);
  // The two grouped leaves no longer sit at the top level.
  expect(tree.some((n) => n.id === 'demo-rect' || n.id === 'demo-text')).toBe(false);
  expect(await bridge(page).getSelectedIds()).toEqual([groupId]);

  // ONE undo entry for the whole group op.
  const historyAfter = await bridge(page).getHistory();
  expect(historyAfter.past.length).toBe(historyBefore.past.length + 1);

  // The panel renders the tree: a group row (edit-group's run() always names
  // it 'Group'), with the two leaves nested underneath at depth 1, each
  // carrying data-group-id = the group's own id.
  const groupRow = page.getByRole('button', { name: 'Select group Group' });
  await expect(groupRow).toBeVisible();
  const nestedRows = page.locator(`li[data-group-id="${groupId}"]`);
  await expect(nestedRows).toHaveCount(2);

  // Collapsing the group unmounts its descendant rows entirely.
  await page.getByRole('button', { name: 'Collapse Group' }).click();
  await expect(page.locator(`[data-group-id="${groupId}"]`)).toHaveCount(0);

  // Expanding restores them.
  await page.getByRole('button', { name: 'Expand Group' }).click();
  await expect(page.locator(`li[data-group-id="${groupId}"]`)).toHaveCount(2);
});

test('@smoke canvas click on a grouped member selects the group; Meta-click selects the leaf and drops the group id', async ({
  page,
}) => {
  await openEditor(page);
  const groupId = await groupRectAndText(page);

  // Deselect first so the next click proves a FRESH promotion, not a
  // carried-over selection.
  await click(page, EMPTY_SPACE);
  expect(await bridge(page).getSelectedIds()).toEqual([]);

  // A plain click on a grouped member promotes to its topmost ancestor group.
  await click(page, RECT_CENTER);
  expect(await bridge(page).getSelectedIds()).toEqual([groupId]);

  // Meta/Ctrl-click is the escape hatch: it selects the RAW leaf and drops
  // the group id from the selection (no [group, descendant] overlap).
  await click(page, RECT_CENTER, [MOD]);
  expect(await bridge(page).getSelectedIds()).toEqual(['demo-rect']);
});

test('@smoke ⌘⇧G restores the flat shape; undo/redo of group/ungroup are each a single entry', async ({
  page,
}) => {
  await openEditor(page);
  const originalTree = await bridge(page).getLayerTree();
  const historyBefore = await bridge(page).getHistory();

  const groupId = await groupRectAndText(page);
  const historyAfterGroup = await bridge(page).getHistory();
  expect(historyAfterGroup.past.length).toBe(historyBefore.past.length + 1);

  await page.keyboard.press(`${MOD}+Shift+g`);
  const historyAfterUngroup = await bridge(page).getHistory();
  expect(historyAfterUngroup.past.length).toBe(historyBefore.past.length + 2);

  const ungroupedTree = await bridge(page).getLayerTree();
  expect(ungroupedTree.some((n) => n.id === groupId)).toBe(false);
  expect(ungroupedTree.map((n) => n.id)).toEqual(originalTree.map((n) => n.id));
  expect(await bridge(page).getSelectedIds()).toEqual(['demo-rect', 'demo-text']);

  // Undo #1 reverts the UNGROUP as one step: the group reappears intact.
  await page.keyboard.press(`${MOD}+z`);
  const afterUndoUngroup = await bridge(page).getLayerTree();
  const restoredGroup = afterUndoUngroup.find((n) => n.id === groupId);
  if (!restoredGroup || restoredGroup.kind !== 'group') {
    throw new Error('undo did not restore the group as one step');
  }
  expect(restoredGroup.children.map((c) => c.id)).toEqual(['demo-rect', 'demo-text']);

  // Undo #2 reverts the GROUP as one step: back to the pristine flat doc.
  await page.keyboard.press(`${MOD}+z`);
  const afterUndoGroup = await bridge(page).getLayerTree();
  expect(afterUndoGroup.map((n) => n.id)).toEqual(originalTree.map((n) => n.id));
  expect((await bridge(page).getHistory()).past.length).toBe(historyBefore.past.length);

  // Redo #1 replays the GROUP, redo #2 replays the UNGROUP.
  await page.keyboard.press(`${MOD}+Shift+z`);
  const afterRedoGroup = await bridge(page).getLayerTree();
  const redoneGroup = afterRedoGroup.find((n) => n.id === groupId);
  if (!redoneGroup || redoneGroup.kind !== 'group')
    throw new Error('redo did not restore the group');
  expect(redoneGroup.children.map((c) => c.id)).toEqual(['demo-rect', 'demo-text']);

  await page.keyboard.press(`${MOD}+Shift+z`);
  const afterRedoUngroup = await bridge(page).getLayerTree();
  expect(afterRedoUngroup.some((n) => n.id === groupId)).toBe(false);
  expect(afterRedoUngroup.map((n) => n.id)).toEqual(originalTree.map((n) => n.id));
});

test('@smoke a one-child group still shows combined chrome: the multi-rotate knob grabs it, not the single-layer path', async ({
  page,
}) => {
  await openEditor(page);
  await click(page, RECT_CENTER);
  expect(await bridge(page).getSelectedIds()).toEqual(['demo-rect']);

  // A lone leaf is groupable (only re-wrapping an ALREADY-a-group selection
  // is rejected) — this makes a one-child group.
  await page.keyboard.press(`${MOD}+g`);
  const tree = await bridge(page).getLayerTree();
  const group = tree.find((n) => n.kind === 'group');
  if (!group || group.kind !== 'group') throw new Error('⌘G did not produce a one-child group');
  expect(group.children.map((c) => c.id)).toEqual(['demo-rect']);
  expect(await bridge(page).getSelectedIds()).toEqual([group.id]);

  // resolveSelectionOverlayMode: any selected id that resolves to a
  // GroupNode is 'combined', regardless of leaf count (selection-resolve.ts)
  // — so ctx.selectedLayer is null for this selection (it isn't a lone
  // LEAF id) and the single-rotate handle path (tryGrabRotateHandle) never
  // runs; only tryGrabMultiRotateHandle can respond here. Grabbing the
  // COMBINED knob position (demo-rect's own bbox top-mid, offset
  // ROTATE_HANDLE_OFFSET_PX screen px up — identical to the single-layer
  // recipe when there's only one rotatable member) and dragging it must
  // still bake a rotation into the child leaf.
  const ROTATE_HANDLE_OFFSET_PX = 20; // mirrors renderer.ts
  const RECT = { x: 8, y: 14, width: 24, height: 16 };
  const topMid = await toScreenPoint(page, { x: RECT.x + RECT.width / 2, y: RECT.y });
  const knob = { x: topMid.x, y: topMid.y - ROTATE_HANDLE_OFFSET_PX };
  const end = await toScreenPoint(page, { x: RECT_CENTER.x + 30, y: RECT_CENTER.y - 30 });

  await page.mouse.move(knob.x, knob.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();

  const rect = (await bridge(page).getMaterialLayer('demo-rect')) as { rotation?: number } | null;
  expect(rect?.rotation).not.toBeUndefined();
  expect(rect?.rotation).not.toBe(0);
});

// A chain of `depth` nested GroupNodes wrapping one leaf; the OUTERMOST
// group is the one returned (it is what ends up at the top level of the
// doc). depth=9 -> the innermost group sits at parse-depth 8 (still legal:
// MAX_GROUP_DEPTH=8 only drops a group whose OWN depth exceeds 8), and
// maxSubtreeDepth(outermost) === 9 — one past the cap.
function nestedGroupChain(depth: number) {
  let node: unknown = {
    id: 'deep-leaf',
    name: 'Deep leaf',
    type: 'shape',
    shape: 'rect',
    x: 2,
    y: 2,
    width: 4,
    height: 4,
    color: 0,
  };
  for (let i = 1; i <= depth; i += 1) {
    node = { kind: 'group', id: `deep-group-${i}`, name: `G${i}`, children: [node] };
  }
  return node;
}

test('@smoke ⌘G that would exceed the depth cap rejects with NO history entry', async ({
  page,
}) => {
  // Seed a doc with a 9-deep group chain (see nestedGroupChain) plus a
  // sibling leaf at the top level. Selecting [outermost-group, sibling-leaf]
  // and wrapping them one level deeper needs
  // maxSubtreeDepth(outermost-group) <= MAX_GROUP_DEPTH (8) — but it is
  // already 9, the exact over-cap case isGroupableRootSelection rejects
  // (commands.ts). Seeded via localStorage.setItem in an addInitScript, same
  // pattern as editor-rotate.spec.ts's delayed-font test.
  await page.addInitScript((deepGroup) => {
    localStorage.setItem(
      'zpd.doc.v1',
      JSON.stringify({
        version: 1,
        savedAt: 0,
        config: {
          version: 4,
          app: 'zpd',
          panel: { hp: 12, widthMm: 65.6, heightMm: 128.5 },
          palette: ['Black', 'Gold', 'White'],
          layers: [
            deepGroup,
            {
              id: 'sibling-leaf',
              name: 'Sibling',
              type: 'shape',
              shape: 'rect',
              x: 40,
              y: 40,
              width: 4,
              height: 4,
              color: 0,
            },
          ],
          guides: [],
        },
      }),
    );
  }, nestedGroupChain(9));
  await openEditor(page);

  const treeBefore = await bridge(page).getLayerTree();
  const outerGroup = treeBefore.find((n) => n.kind === 'group');
  if (!outerGroup) throw new Error('seeded 9-deep group chain missing');

  await click(page, { x: 4, y: 4 }); // inside deep-group-9's leaf -> promotes to outerGroup
  await click(page, { x: 42, y: 42 }, ['Shift']); // adds sibling-leaf
  // Tree DFS/array order: [outerGroup, sibling-leaf] (selection.ts normalizes
  // selectedIds to tree order, not click order).
  expect(await bridge(page).getSelectedIds()).toEqual([outerGroup.id, 'sibling-leaf']);

  const historyBefore = await bridge(page).getHistory();
  await page.keyboard.press(`${MOD}+g`);
  const historyAfter = await bridge(page).getHistory();

  expect(historyAfter).toEqual(historyBefore);
  const treeAfter = await bridge(page).getLayerTree();
  expect(treeAfter).toEqual(treeBefore);
});
