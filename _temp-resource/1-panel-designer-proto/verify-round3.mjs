import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(`${process.env.HOME}/.claude/skills/headless-browser/node_modules/playwright`);
const SHOTS = '/mnt/c/Users/takaz/Dropbox/cclogs/zpd/headless-screenshots';
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:15100/', { waitUntil: 'networkidle' });
const box = await page.locator('.canvas-container canvas').boundingBox();

// pen draft with 3 points -> Close path button appears; click it
await page.click('button[title="pen (P)"]');
await page.mouse.click(box.x + 450, box.y + 150);
await page.mouse.click(box.x + 560, box.y + 210);
await page.mouse.click(box.x + 470, box.y + 330);
await page.waitForTimeout(150);
await page.screenshot({ path: `${SHOTS}/proto3-pen-buttons.png` });
await page.click('button:has-text("Close path")');
await page.waitForTimeout(150);
const layers = await page.locator('.layer-list li .layer-name').allTextContents();
console.log('after Close path button:', JSON.stringify(layers.map((s) => s.trim())));

// zoom tool: click to zoom in at point, alt-click out
await page.click('button[title="zoom (Z)"]');
await page.mouse.click(box.x + 500, box.y + 300);
await page.mouse.click(box.x + 500, box.y + 300);
let zoomText = await page.locator('.zoom-display').textContent();
console.log('zoom after 2 zoom-tool clicks:', zoomText);
await page.keyboard.down('Alt');
await page.mouse.click(box.x + 500, box.y + 300);
await page.keyboard.up('Alt');
zoomText = await page.locator('.zoom-display').textContent();
console.log('zoom after alt-click:', zoomText);

// header +/- buttons
await page.click('button[title="Zoom in"]');
console.log('zoom after + button:', await page.locator('.zoom-display').textContent());
await page.click('button[title="Zoom out"]');
await page.screenshot({ path: `${SHOTS}/proto3-zoom.png` });
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
