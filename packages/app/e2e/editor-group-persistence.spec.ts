// Persistence + clipboard integration coverage (#158, confirming #146's v4
// serialize format and #156's clipboard v2 envelope). Real trusted input only
// (page.mouse / page.keyboard / setInputFiles via importPanelJson) except for
// the clipboard paste, which — like editor-composer-parity.spec.ts's own
// clipboard test — dispatches a real ClipboardEvent carrying a DataTransfer,
// the only way to feed OS-clipboard-shaped text into the app's `paste`
// listener without an actual OS clipboard permission grant. State is
// asserted through the window.__zpdTest bridge, never by pixel-probing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { bridge, importPanelJson, MOD, openEditor, toScreenPoint } from './helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const V3_FIXTURE = path.join(__dirname, 'fixtures', 'preview-manufacturing.json');

// demo-doc.ts geometry: demo-rect (8,14) 24x16 -> center (20,22);
// demo-ellipse (30,40) 22x22 -> center (41,51).
const RECT_CENTER = { x: 20, y: 22 };
const ELLIPSE_CENTER = { x: 41, y: 51 };

async function click(page: Page, mm: { x: number; y: number }, modifiers: string[] = []) {
  const pt = await toScreenPoint(page, mm);
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.click(pt.x, pt.y);
  for (const key of [...modifiers].reverse()) await page.keyboard.up(key);
}

test('@smoke export -> import a grouped doc round-trips intact at v4', async ({ page }) => {
  await openEditor(page);
  await click(page, RECT_CENTER);
  await click(page, ELLIPSE_CENTER, ['Shift']);
  await page.keyboard.press(`${MOD}+g`);

  const treeBefore = await bridge(page).getLayerTree();
  const group = treeBefore.find((n) => n.kind === 'group');
  if (!group || group.kind !== 'group') throw new Error('setup: ⌘G did not produce a group');
  expect(group.children.map((c) => c.id)).toEqual(['demo-rect', 'demo-ellipse']);

  const exported = await bridge(page).serialize();
  expect(exported.version).toBe(4);
  const docBefore = await bridge(page).getDoc();

  const tmpPath = path.join(__dirname, '..', 'test-results', 'group-export-roundtrip.json');
  fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
  fs.writeFileSync(tmpPath, JSON.stringify(exported));

  // Mutate the LIVE doc after exporting (delete the group and everything
  // else) so the import assertions below can only pass if importPanelJson
  // actually replaced the document — codex review finding: without this,
  // export -> import is a no-op on an already-matching doc and the
  // equality checks below would pass even if Replace silently did nothing.
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.press('Delete');
  expect(await bridge(page).getLayerTree()).not.toEqual(treeBefore);

  await importPanelJson(page, tmpPath);

  const treeAfter = await bridge(page).getLayerTree();
  expect(treeAfter).toEqual(treeBefore);
  const docAfter = await bridge(page).getDoc();
  expect(docAfter).toEqual(docBefore);
});

test('@smoke a pre-existing v3 fixture still loads unchanged (identity migration)', async ({ page }) => {
  await openEditor(page);
  await importPanelJson(page, V3_FIXTURE);

  const fixture = JSON.parse(fs.readFileSync(V3_FIXTURE, 'utf-8')) as {
    version: number;
    layers: { id: string; type: string; name: string }[];
  };
  expect(fixture.version).toBe(3);

  // Identity migration: a v3 doc has no group nodes at all, so every fixture
  // layer must arrive as a top-level LEAF, in the same order, same ids/types.
  const tree = await bridge(page).getLayerTree();
  expect(tree.every((n) => n.kind === 'layer')).toBe(true);
  expect(tree.map((n) => n.id)).toEqual(fixture.layers.map((l) => l.id));
  expect(tree.map((n) => (n.kind === 'layer' ? n.type : null))).toEqual(
    fixture.layers.map((l) => l.type),
  );

  // This app now serializes at v4 — re-serializing the migrated doc must not
  // silently resurrect a v3 shape.
  const reserialized = await bridge(page).serialize();
  expect(reserialized.version).toBe(4);
  expect(reserialized.layers.map((l) => l.id)).toEqual(fixture.layers.map((l) => l.id));
});

test('@smoke copy -> paste a group across the v2 clipboard envelope preserves structure with fresh ids', async ({
  page,
}) => {
  await openEditor(page);
  const before = await bridge(page).getLayerCount();
  const historyBefore = await bridge(page).getHistory();

  await page.evaluate(() => {
    const envelope = {
      app: 'zpd',
      kind: 'layers',
      version: 2,
      layers: [
        {
          kind: 'group',
          id: 'src-group',
          name: 'Envelope group',
          children: [
            {
              id: 'src-a',
              name: 'A',
              type: 'shape',
              shape: 'rect',
              x: 5,
              y: 5,
              width: 10,
              height: 10,
              color: 1,
            },
            {
              id: 'src-b',
              name: 'B',
              type: 'shape',
              shape: 'ellipse',
              x: 20,
              y: 20,
              width: 8,
              height: 8,
              color: 2,
              hidden: true,
            },
          ],
        },
      ],
    };
    const dt = new DataTransfer();
    dt.setData('text/plain', JSON.stringify(envelope));
    window.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  });

  // A group envelope inserts as ONE new leaf-count delta of 2 (the group's
  // two children) — getLayerCount() is the LEAF count, groups don't add to it.
  expect(await bridge(page).getLayerCount()).toBe(before + 2);

  const tree = await bridge(page).getLayerTree();
  const pasted = tree.find(
    (n) => n.kind === 'group' && n.children.some((c) => c.name === 'A' || c.name === 'B'),
  );
  if (!pasted || pasted.kind !== 'group') throw new Error('pasted group not found in getLayerTree()');
  expect(pasted.id).not.toBe('src-group'); // fresh id — cloneNodeWithFreshIds mints one root-to-leaf
  expect(pasted.name).toBe('Envelope group'); // structure-preserving: name survives
  expect(pasted.children).toHaveLength(2);
  const [childA, childB] = pasted.children;
  expect(childA.kind).toBe('layer');
  expect(childB.kind).toBe('layer');
  expect(childA?.id).not.toBe('src-a');
  expect(childB?.id).not.toBe('src-b');
  expect(childB?.hidden).toBe(true); // per-child hidden flag survives the round trip

  const doc = await bridge(page).getDoc();
  const groupNode = doc.layers.find((l) => l.id === pasted.id);
  if (!groupNode || groupNode.kind !== 'group') throw new Error('pasted group missing from getDoc()');
  const [a, b] = groupNode.children as { x: number; y: number }[];
  // 2mm cascade offset applied to every LEAF of the pasted subtree.
  expect(a.x).toBeCloseTo(7, 5);
  expect(a.y).toBeCloseTo(7, 5);
  expect(b.x).toBeCloseTo(22, 5);
  expect(b.y).toBeCloseTo(22, 5);

  // ONE undo entry for the whole pasted subtree.
  expect((await bridge(page).getHistory()).past.length).toBe(historyBefore.past.length + 1);
  await page.keyboard.press(`${MOD}+z`);
  expect(await bridge(page).getLayerCount()).toBe(before);
});

test('@smoke numeric-rotate Escape leaves zero undo/redo residue', async ({ page }) => {
  await openEditor(page);
  await click(page, RECT_CENTER);
  await click(page, ELLIPSE_CENTER, ['Shift']);

  const historyBefore = await bridge(page).getHistory();
  const docBefore = await bridge(page).getDoc();

  const rotateInput = page.getByLabel('Rotate selection (°)');
  await expect(rotateInput).toBeVisible();
  // Several keystrokes worth of edits — abortGesture must unwind the WHOLE
  // gesture (one beginGesture, however many replace() ticks), not just the
  // last one.
  await rotateInput.fill('10');
  await rotateInput.fill('47');
  await rotateInput.press('Escape');

  expect(await bridge(page).getHistory()).toEqual(historyBefore);
  expect(await bridge(page).getDoc()).toEqual(docBefore);
});

// KNOWN PRODUCT BUG (#157, filed for the manager rather than patched here —
// see this worktree's e2e-confirm log for full triage). Root cause, isolated
// via instrumented tracing (source left untouched — `git diff` on
// rotate-selection-panel.tsx is empty):
//
// RotateSelectionPanel's render-time recapture guard —
//   `eligible && (key !== capturedKey || (!gestureOpen && tree !== capturedTree))`
// — assumes the component's OWN local state (`gestureOpen`, set by cancel())
// and the PARENT's `ctx.doc` (updated by the ctx.abortGesture() dispatch
// cancel() also fires) always land in the SAME React commit. In a real
// browser they do not always: instrumented logging on this exact repro
// caught a render where `gestureOpen` had already flipped to `false` but
// `ctx.doc.layers` was STILL the pre-abort (stale, mid-gesture) tree. At
// THAT render the guard's `!gestureOpen && tree !== capturedTree` reads
// true and recaptures a session from the stale, not-yet-reverted tree —
// latching `capturedTree`/`session` onto it. `ctx.doc` does correctly
// revert a moment later (confirmed: the two assertions in the PASSING test
// above hold), but this component's OWN captured baseline never
// self-corrects, so the NEXT edit bakes on top of the abandoned delta
// instead of from zero: type 10, type 47, Escape (doc/history correctly
// revert), then type 45 bakes to 92° (= 47 + 45), not 45°.
//
// The existing unit suite (rotate-selection-panel.test.tsx's "full type ->
// Escape -> type -> Enter cycle" test) exercises the identical LOGICAL
// sequence and passes — but React Testing Library's fireEvent wraps every
// dispatch in a synchronous act() that force-flushes cross-component
// updates together, which papers over exactly this render-order race. That
// gap is itself worth closing (a browser-timing-only regression like this
// has no unit-level tripwire), but is out of scope for this pass.
//
// Not patched here: a correct fix needs to make the guard resilient to
// child-before-parent commit ordering (e.g. a ref cancel() sets to suppress
// exactly one spurious recapture, or moving the capture to a post-commit
// effect) without regressing the 10 other scenarios rotate-selection-
// panel.test.tsx already protects (mid-gesture external-edit immunity,
// idle external-edit recapture, selection-change reset, etc.) — that is a
// deliberate, non-trivial design change, not a one-line fix.
test.fail(
  '@smoke [KNOWN BUG #157] typing again immediately after an Escape can bake on top of the abandoned pre-abort delta',
  async ({ page }) => {
    await openEditor(page);
    await click(page, RECT_CENTER);
    await click(page, ELLIPSE_CENTER, ['Shift']);

    const rotateInput = page.getByLabel('Rotate selection (°)');
    await expect(rotateInput).toBeVisible();
    await rotateInput.fill('10');
    await rotateInput.fill('47');
    await rotateInput.press('Escape');

    // The row is usable again afterward — not left stuck mid-gesture.
    await rotateInput.fill('45');
    await rotateInput.press('Enter');
    const rect = (await bridge(page).getDoc()).layers.find((l) => l.id === 'demo-rect') as {
      rotation?: number;
    };
    // Spec-accurate expectation (currently fails: bakes to 92, see comment
    // above for the confirmed root cause).
    expect(rect.rotation).toBe(45);
  },
);
