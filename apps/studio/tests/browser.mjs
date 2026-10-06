// Browser smoke test for the studio: boots the CAD workspace, edits a feature, imports a
// scan, exports, and opens the Optics and Wind tunnel tabs. Needs Playwright + Chromium:
//   npm install --no-save playwright && npx playwright install chromium
//   node apps/studio/tests/browser.mjs        (run from the repository root)
// Set LABSTUDIO_CHROMIUM to use a Chromium binary you already have.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import('playwright');
const port = Number(process.env.LABSTUDIO_TEST_PORT || 5187), out = 'test-results/studio';
const server = spawn(process.execPath, ['scripts/serve.mjs', `--port=${port}`], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((ok, fail) => { server.stdout.once('data', ok); server.once('error', fail); });
let browser;
try {
  await mkdir(out, { recursive: true });
  browser = await chromium.launch({ executablePath: process.env.LABSTUDIO_CHROMIUM, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__labstudio?.result?.part);
  const vol = () => page.evaluate(() => window.__labstudio.result.part.volume());
  const v0 = await vol();
  assert.ok(v0 > 10_000, 'default birdbath housing has a real volume');
  await page.screenshot({ path: `${out}/birdbath.png` });

  // Make the housing walls thicker by growing the outer box, then undo.
  await page.locator('#tree li:not(.group)').first().click();
  const width = page.locator('#props input[type=number]').first();
  await width.fill('80'); await width.press('Enter');
  await page.waitForFunction((v) => window.__labstudio.result.part.volume() > v * 1.2, v0);
  await page.click('#undoBtn');
  await page.waitForFunction((v) => Math.abs(window.__labstudio.result.part.volume() - v) < 1e-6, v0);

  // Import a closed STL (a 10 mm cube), drop it in as a part.
  const cube = new Uint8Array(84 + 50 * 12);
  const V = [[0,0,0],[10,0,0],[10,10,0],[0,10,0],[0,0,10],[10,0,10],[10,10,10],[0,10,10]];
  const T = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  const dv = new DataView(cube.buffer); dv.setUint32(80, 12, true);
  T.forEach((t, i) => t.forEach((v, k) => V[v].forEach((c, j) => dv.setFloat32(84 + 50 * i + 12 + 12 * k + 4 * j, c, true))));
  await writeFile(`${out}/cube.stl`, cube);
  await page.setInputFiles('#scanFile', `${out}/cube.stl`);
  await page.click('#impGo');
  await page.waitForFunction(() => window.__labstudio.doc.features.some((f) => f.type === 'mesh'));

  // Export STL.
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-export="stl"]')]);
  assert.match(dl.suggestedFilename(), /\.stl$/);

  // Other workspaces load in frames.
  await page.click('[data-tab="optics"]');
  await page.frameLocator('#tab-optics iframe').locator('body').waitFor();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/optics.png` });
  await page.click('[data-tab="tunnel"]');
  await page.frameLocator('#tab-tunnel iframe').locator('#status').waitFor();
  await page.screenshot({ path: `${out}/tunnel.png` });

  assert.deepEqual(errors, [], 'no page errors');
  console.log('Studio browser check passed. Screenshots in', out);
} finally {
  await browser?.close();
  server.kill();
}
