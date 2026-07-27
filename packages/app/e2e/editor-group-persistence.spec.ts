// Persistence + clipboard integration coverage (#158/#169, confirming the v5
// fixed PCB stack and the clipboard v3 material envelope). Real trusted input only
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
const V3_FIXTURE = path.join(__dirname, 'fixtures', 'legacy-v3-panel.json');

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

test('@smoke export -> import a grouped doc round-trips intact at v6', async ({ page }) => {
  await openEditor(page);
  // Groups cannot span fixed materials. Rect + Text are both ordinary
  // Silkscreen children, selected through the real Layers UI.
  await page.getByRole('button', { name: 'Select layer Rect' }).click();
  await page.getByRole('button', { name: 'Select layer Text' }).click({ modifiers: ['Shift'] });
  await page.keyboard.press(`${MOD}+g`);

  const treeBefore = await bridge(page).getLayerTree();
  const group = treeBefore.find((n) => n.kind === 'group');
  if (!group || group.kind !== 'group') throw new Error('setup: ⌘G did not produce a group');
  expect(group.children.map((c) => c.id)).toEqual(['demo-rect', 'demo-text']);

  const exported = await bridge(page).serialize();
  expect(exported.version).toBe(6);
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

// These two tests used to be one: "a pre-existing v3 fixture migrates into the
// v5 fixed material stack without losing leaves". Epic #226 deleted migration
// outright (no users yet — see the compat-cut notes in core/serialize.ts and
// editor/doc-store.ts), so there is no longer any migration to assert. They now
// pin the contract that REPLACED it, which is not one behaviour but two: an
// imported pre-v6 file is refused and the open document survives, while a
// pre-v6 payload already in storage simply boots the default document.
//
// legacy-v3-panel.json is deliberately kept as the fixture. A well-formed but
// out-of-date zpd file is a different input class from the malformed JSON
// covered by editor-composer-parity.spec.ts's garbage-import test, and it is
// the one a real user hits after a rollback.

test('@smoke a pre-v6 panel file is refused on import, leaving the open document untouched', async ({
  page,
}) => {
  await openEditor(page);
  const before = await bridge(page).serialize();

  const fixture = JSON.parse(fs.readFileSync(V3_FIXTURE, 'utf-8')) as { version: number };
  expect(fixture.version).toBe(3);

  // Not importPanelJson(): that helper confirms the "Replace current panel?"
  // dialog, and the whole point here is that a rejected file never reaches it.
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByTitle('Import panel config JSON').click(),
  ]);
  await chooser.setFiles(V3_FIXTURE);

  // The toast names the version as the reason, so this can't pass on some
  // unrelated parse failure that happens to share the title.
  await expect(page.getByText('Could not import panel JSON')).toBeVisible();
  await expect(page.getByText('this build reads only v6')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Replace current panel?' })).toHaveCount(0);

  expect(await bridge(page).serialize()).toStrictEqual(before);
});

test('@smoke a pre-v6 autosave entry boots the default document instead of migrating it', async ({
  page,
}) => {
  // Seeded raw, NOT via seedStoredDoc: that helper always writes the current
  // schema, and a stale payload is exactly what this test needs. The storage
  // envelope stays current (v2) so the ONLY thing under test is the pre-v6
  // config inside it. doc-store.test.ts covers the sibling cases at the unit
  // level (legacy zpd.doc.v1 key, corrupt bytes, retention of the raw entry).
  const legacyConfig = fs.readFileSync(V3_FIXTURE, 'utf-8');
  await page.addInitScript((config) => {
    localStorage.setItem(
      'zpd.doc.v2',
      JSON.stringify({ version: 2, savedAt: 0, config: JSON.parse(config) }),
    );
  }, legacyConfig);
  await openEditor(page);

  // The demo document, not the fixture's legacy-* leaves.
  const ids = (await bridge(page).getLayerTree()).map((node) => node.id);
  expect(ids).not.toContain('legacy-copper');
  expect(ids).toContain('demo-rect');
  expect((await bridge(page).serialize()).version).toBe(6);
});

test('@smoke copy -> paste a group across the v3 material clipboard envelope preserves structure with fresh ids', async ({
  page,
}) => {
  await openEditor(page);
  const before = await bridge(page).getLayerCount();
  const historyBefore = await bridge(page).getHistory();

  await page.evaluate(() => {
    const envelope = {
      app: 'zpd',
      kind: 'layers',
      version: 3,
      layers: [
        {
          material: 'copper',
          node: {
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
  if (!pasted || pasted.kind !== 'group')
    throw new Error('pasted group not found in getLayerTree()');
  expect(pasted.id).not.toBe('src-group'); // fresh id — cloneNodeWithFreshIds mints one root-to-leaf
  expect(pasted.name).toBe('Envelope group'); // structure-preserving: name survives
  expect(pasted.children).toHaveLength(2);
  const [childA, childB] = pasted.children;
  expect(childA.kind).toBe('layer');
  expect(childB.kind).toBe('layer');
  expect(childA?.id).not.toBe('src-a');
  expect(childB?.id).not.toBe('src-b');
  expect(childB?.hidden).toBe(true); // per-child hidden flag survives the round trip

  const a = await bridge(page).getMaterialLayer(childA.id);
  const b = await bridge(page).getMaterialLayer(childB.id);
  if (a?.type !== 'shape' || b?.type !== 'shape') {
    throw new Error('pasted group children missing from material projection');
  }
  expect(a.material).toBe('copper');
  expect(b.material).toBe('copper');
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

// Regression guard for a #157 bug found by #158's integration pass: typing
// again immediately after an Escape used to bake ON TOP of the abandoned
// pre-abort delta (10, 47, Escape, 45 => 92° instead of 45°).
//
// Root cause: ctx.doc reads Editor's docRef, which is synced in a passive
// effect AFTER each commit — so in the one render flush that cancel()
// triggers (its ctx.abortGesture() dispatch and setGestureOpen(false) batch
// together), RotateSelectionPanel saw its OWN state already fresh
// (gestureOpen=false) while `ctx.doc.layers` was still the pre-abort
// mid-gesture tree. Its idle-recapture guard (`!gestureOpen && tree !==
// capturedTree`) then latched `capturedTree`/`session` onto that abandoned
// tree, and since the later docRef sync is a ref write (no re-render), the
// baseline never self-corrected.
//
// Fix (rotate-selection-panel.tsx): provenance, not timing — applyDelta
// records each baked tree (`lastBakedTree`), and the idle-recapture branch
// skips any tree matching it: a tree that IS the row's own bake output is
// never an external edit, so recapturing from it is wrong under every
// circumstance. Legitimate idle recaptures (external edit under an
// unchanged selection) still fire — an external tree can never be
// reference-equal to the row's own abandoned bake — and every such
// recapture clears the marker. No recapture is needed for the abort
// itself: abortGesture restores present to the exact object the session was
// captured from, so once it lands, tree === capturedTree again by
// reference. A unit-level tripwire that reproduces this child-fresh/
// parent-stale ordering (a lagging ctx.doc harness) now lives in
// rotate-selection-panel.test.tsx.
test('@smoke typing again immediately after an Escape bakes from the pre-gesture baseline, not the abandoned pre-abort delta', async ({
  page,
}) => {
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
  const rect = (await bridge(page).getMaterialLayer('demo-rect')) as {
    rotation?: number;
  };
  // Baked from the pre-gesture baseline — 92 (= 47 + 45) here means the
  // abandoned pre-abort delta leaked back in (see comment above).
  expect(rect.rotation).toBe(45);
});
