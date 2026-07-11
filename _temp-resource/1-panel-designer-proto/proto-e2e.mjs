// Prototype verification via real (trusted) Playwright input events.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require(
  `${process.env.HOME}/.claude/skills/headless-browser/node_modules/playwright`,
);

const SHOTS = '/mnt/c/Users/takaz/Dropbox/cclogs/zpd/headless-screenshots';
const URL = 'http://127.0.0.1:15100/';

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(`console: ${m.text()}`);
});

await page.goto(URL, { waitUntil: 'networkidle' });

const canvas = page.locator('.canvas-container canvas');
const box = await canvas.boundingBox();
const at = (x, y) => ({ x: box.x + x, y: box.y + y });

const layerNames = async () =>
  (await page.locator('.layer-list li .layer-name').allTextContents()).map((s) => s.trim());

// --- 1. pen tool: draw a closed bezier path -------------------------------
await page.click('button[title="pen (P)"]');
const p1 = at(450, 150);
await page.mouse.click(p1.x, p1.y);
// curved anchor via drag
const p2 = at(560, 210);
await page.mouse.move(p2.x, p2.y);
await page.mouse.down();
await page.mouse.move(p2.x + 35, p2.y + 45, { steps: 4 });
await page.mouse.up();
const p3 = at(470, 330);
await page.mouse.click(p3.x, p3.y);
// close by clicking the first anchor
await page.mouse.click(p1.x, p1.y);
await page.waitForTimeout(200);
const afterPen = await layerNames();
console.log('after pen:', JSON.stringify(afterPen));
await page.screenshot({ path: `${SHOTS}/proto2-e2e-1-pen.png` });

// --- 2. node editing: drag an anchor ---------------------------------------
await page.mouse.move(p3.x, p3.y);
await page.mouse.down();
await page.mouse.move(p3.x - 40, p3.y + 60, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(150);
await page.screenshot({ path: `${SHOTS}/proto2-e2e-2-node-edit.png` });

// --- 3. text tool with Google Font -----------------------------------------
await page.click('button[title="text (T)"]');
const tp = at(430, 500);
await page.mouse.click(tp.x, tp.y);
await page.waitForTimeout(1200); // font fetch
console.log('after text:', JSON.stringify(await layerNames()));
// change the text via inspector
await page.locator('textarea').fill('ZUDO');
await page.locator('select').nth(1).selectOption('Orbitron');
await page.waitForTimeout(1500); // font load + repaint
await page.screenshot({ path: `${SHOTS}/proto2-e2e-3-text.png` });

// --- 4. zoom (wheel at pointer) + pan (space-drag) --------------------------
await page.mouse.move(box.x + 500, box.y + 300);
await page.mouse.wheel(0, -400);
await page.mouse.wheel(0, -400);
await page.waitForTimeout(150);
const zoomText = await page.locator('.zoom-display').textContent();
console.log('zoom after wheel:', zoomText);
await page.keyboard.down('Space');
await page.mouse.move(box.x + 500, box.y + 300);
await page.mouse.down();
await page.mouse.move(box.x + 300, box.y + 250, { steps: 3 });
await page.mouse.up();
await page.keyboard.up('Space');
await page.waitForTimeout(150);
await page.screenshot({ path: `${SHOTS}/proto2-e2e-4-zoom-pan.png` });
await page.click('button[title="Fit panel"]');

// --- 5. image add + trace to vectors ----------------------------------------
// generate a test PNG in-page (two-tone logo-ish shape)
const dataUrl = await page.evaluate(() => {
  const c = document.createElement('canvas');
  c.width = 240;
  c.height = 240;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 240, 240);
  ctx.fillStyle = '#111111';
  ctx.beginPath();
  ctx.arc(120, 100, 70, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#c9a227';
  ctx.beginPath();
  ctx.moveTo(40, 220);
  ctx.lineTo(200, 220);
  ctx.lineTo(120, 120);
  ctx.closePath();
  ctx.fill();
  return c.toDataURL('image/png');
});
const png = Buffer.from(dataUrl.split(',')[1], 'base64');
writeFileSync('/tmp/zpd-test-image.png', png);
await page.setInputFiles('input[type=file]', '/tmp/zpd-test-image.png');
await page.waitForTimeout(400);
console.log('after image:', JSON.stringify(await layerNames()));
await page.click('text=Convert to vector…');
await page.waitForSelector('.trace-preview img', { timeout: 15000 });
await page.waitForTimeout(400);
await page.screenshot({ path: `${SHOTS}/proto2-e2e-5-trace-dialog.png` });
await page.click('text=Expand to vector layers');
await page.waitForTimeout(400);
const afterTrace = await layerNames();
console.log('after trace:', JSON.stringify(afterTrace.slice(0, 8)), `(total ${afterTrace.length})`);
await page.screenshot({ path: `${SHOTS}/proto2-e2e-6-traced.png` });

// --- 6. undo + JSON download --------------------------------------------------
await page.click('button:has-text("Undo")');
await page.waitForTimeout(150);
console.log('after undo:', JSON.stringify((await layerNames()).slice(0, 6)));
const downloadPromise = page.waitForEvent('download');
await page.click('button:has-text("Download JSON")');
const download = await downloadPromise;
const path = await download.path();
const { readFileSync } = await import('node:fs');
const json = JSON.parse(readFileSync(path, 'utf8'));
console.log(
  'json:',
  JSON.stringify({
    version: json.version,
    panel: json.panel,
    palette: json.palette,
    layerCount: json.layers.length,
    layerTypes: [...new Set(json.layers.map((l) => l.type))],
  }),
);

console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
