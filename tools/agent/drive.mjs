#!/usr/bin/env node
// LabStudio browser driver for agents (and people). Runs a scenario of steps in
// Chromium with Playwright, against the repo's own dev server, and writes a report
// an agent can read back: what passed, what failed and why, page errors, console
// errors, and screenshots.
//
//   node tools/agent/drive.mjs tools/agent/scenarios/studio-smoke.json
//   node tools/agent/drive.mjs --map /apps/studio/web/          # list clickable things and their selectors
//   node tools/agent/drive.mjs scenario.json --headed --keep-going
//
// Options: --port=5190  --url=http://host:port (skip the local server)  --out=dir
//          --headed  --keep-going (run every step even after a failure)
// Env:     LABSTUDIO_CHROMIUM=/path/to/chrome  (use a Chromium you already have)
//
// Scenario file (JSON):
// { "name": "...", "start": "/", "viewport": [1440, 900], "steps": [ {"do": "...", ...}, ... ] }
// Every step can also take: "frame": "optics" | "tunnel" | "<part of a frame URL>"
//   to act inside that workspace's iframe, "timeout": ms, "soft": true (failure is
//   recorded but does not stop the run), "note": "why this step exists".
//
// Steps:
//   {"do":"goto", "path":"/apps/studio/web/"}
//   {"do":"tab", "name":"model"|"optics"|"tunnel"|"<data-tab value>"}
//   {"do":"click", "sel":"#saveBtn"}                 any Playwright selector, e.g. "text=Box"
//   {"do":"fill", "sel":"#impFit", "value":"120"}    then fires change via Enter
//   {"do":"press", "sel":"body", "key":"Control+z"}
//   {"do":"select", "sel":"#material", "value":"1.27"}
//   {"do":"upload", "sel":"#scanFile", "file":"path/to/file.stl"}
//   {"do":"wait", "ms":500}
//   {"do":"waitFor", "sel":"#importPanel:not([hidden])"}  or  {"do":"waitFor", "js":"window.__labstudio?.result"}
//   {"do":"eval", "js":"window.__labstudio.result.part.volume()", "save":"v0"}
//   {"do":"expect", "js":"...", "equals":x | "approx":x, "tol":0.01 (relative) | "min":a, "max":b | "truthy":true}
//       inside "js", earlier saved values are available as `saved.v0`
//   {"do":"expectText", "sel":"#status", "contains":"Birdbath"}
//   {"do":"download", "sel":"[data-export=stl]", "expectName":"\\.stl$"}
//   {"do":"screenshot", "name":"after-import"}       (full page if "full": true)
//   {"do":"map"}                                     record the page's interactive elements
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const flag = (k) => args.includes(`--${k}`);
const positional = args.filter((a) => !a.startsWith('--'));

let scenario;
if (flag('map')) scenario = { name: 'map', start: positional[0] || '/apps/studio/web/', steps: [{ do: 'wait', ms: 1500 }, { do: 'map' }, { do: 'screenshot', name: 'page' }] };
else if (positional[0]) scenario = JSON.parse(await readFile(positional[0], 'utf8'));
else { console.error('Usage: node tools/agent/drive.mjs <scenario.json> | --map [path]'); process.exit(2); }

const port = Number(opt('port', 5190));
const base = opt('url', `http://127.0.0.1:${port}`);
const out = resolve(ROOT, opt('out', `test-results/agent/${(scenario.name || basename(positional[0] || 'run', '.json')).replace(/[^\w.-]+/g, '-')}`));
await mkdir(out, { recursive: true });

let playwright;
try { playwright = await import('playwright'); } catch {
  console.error('Playwright is not installed. Run: npm install && npx playwright install chromium');
  process.exit(2);
}

let server;
if (!opt('url')) {
  server = spawn(process.execPath, [resolve(ROOT, 'scripts/serve.mjs'), `--port=${port}`, `--root=${ROOT}`], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((ok, fail) => { server.stdout.once('data', ok); server.once('error', fail); server.once('exit', (c) => fail(new Error(`dev server exited (${c}); is port ${port} busy? try --port=`))); });
}

const report = { scenario: scenario.name, base, startedAt: new Date().toISOString(), steps: [], pageErrors: [], consoleErrors: [], failedRequests: [], screenshots: [], map: null, ok: true };
const saved = {};
let browser;
try {
  browser = await playwright.chromium.launch({
    headless: !flag('headed'),
    executablePath: process.env.LABSTUDIO_CHROMIUM || undefined,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu'],
  });
  const [w, h] = scenario.viewport || [1440, 900];
  const context = await browser.newContext({ viewport: { width: w, height: h }, acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => report.pageErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(m.text()); });
  page.on('requestfailed', (r) => report.failedRequests.push(`${r.url()} (${r.failure()?.errorText})`));
  await page.goto(base + (scenario.start || '/'));

  const FRAMES = { optics: 'mirrorlab', tunnel: 'splattunnel', materials: 'apps/materials' };
  const scope = async (s) => {
    if (!s.frame) return page;
    const needle = FRAMES[s.frame] || s.frame;
    const t0 = Date.now();
    for (;;) {
      const f = page.frames().find((fr) => fr.url().includes(needle));
      if (f) return f;
      if (Date.now() - t0 > (s.timeout || 15000)) throw new Error(`no frame whose URL contains "${needle}" (open its tab first)`);
      await page.waitForTimeout(100);
    }
  };
  const evalIn = (target, js) => target.evaluate(({ js, saved }) => (0, eval)(`(saved) => (${js})`)(saved), { js, saved });
  const approxOk = (v, s) => Math.abs(v - s.approx) <= (s.tol ?? 1e-6) * Math.max(Math.abs(s.approx), 1e-12);

  const ACTIONS = {
    goto: async (s) => { await page.goto(base + s.path); },
    tab: async (s) => {
      const b = page.locator(`[data-tab="${s.name}"]`);
      if (!(await b.count())) throw new Error(`no tab "${s.name}" (tabs: ${(await page.locator('[data-tab]').evaluateAll((els) => els.map((e) => e.dataset.tab))).join(', ')})`);
      await b.click(); await page.waitForTimeout(s.settle ?? 300);
    },
    click: async (s, t) => { await t.locator(s.sel).first().click({ timeout: s.timeout }); },
    fill: async (s, t) => { const l = t.locator(s.sel).first(); await l.fill(String(s.value), { timeout: s.timeout }); await l.press('Enter'); },
    press: async (s, t) => { await t.locator(s.sel || 'body').first().press(s.key, { timeout: s.timeout }); },
    select: async (s, t) => { await t.locator(s.sel).first().selectOption(String(s.value), { timeout: s.timeout }); },
    upload: async (s, t) => { await t.locator(s.sel).first().setInputFiles(resolve(ROOT, s.file), { timeout: s.timeout }); },
    wait: async (s) => { await page.waitForTimeout(s.ms ?? 500); },
    waitFor: async (s, t) => {
      if (s.js) await t.waitForFunction(({ js, saved }) => (0, eval)(`(saved) => (${js})`)(saved), { js: s.js, saved }, { timeout: s.timeout ?? 30000 });
      else await t.locator(s.sel).first().waitFor({ timeout: s.timeout ?? 30000 });
    },
    eval: async (s, t) => { const v = await evalIn(t, s.js); if (s.save) saved[s.save] = v; return v; },
    expect: async (s, t) => {
      const v = await evalIn(t, s.js);
      const pass = 'equals' in s ? JSON.stringify(v) === JSON.stringify(s.equals)
        : 'approx' in s ? approxOk(v, s)
        : 'min' in s || 'max' in s ? v >= (s.min ?? -Infinity) && v <= (s.max ?? Infinity)
        : Boolean(v);
      if (!pass) throw new Error(`expected ${JSON.stringify({ equals: s.equals, approx: s.approx, tol: s.tol, min: s.min, max: s.max })}, got ${JSON.stringify(v)}`);
      return v;
    },
    expectText: async (s, t) => {
      const text = await t.locator(s.sel).first().innerText({ timeout: s.timeout });
      if (!text.includes(s.contains)) throw new Error(`"${s.sel}" text is ${JSON.stringify(text.slice(0, 200))}; expected it to contain ${JSON.stringify(s.contains)}`);
      return text.slice(0, 200);
    },
    download: async (s, t) => {
      const [d] = await Promise.all([page.waitForEvent('download', { timeout: s.timeout ?? 15000 }), t.locator(s.sel).first().click()]);
      const name = d.suggestedFilename();
      await d.saveAs(resolve(out, name));
      if (s.expectName && !new RegExp(s.expectName).test(name)) throw new Error(`downloaded ${name}, expected /${s.expectName}/`);
      return name;
    },
    screenshot: async (s) => { const p = resolve(out, `${String(report.screenshots.length).padStart(2, '0')}-${s.name || 'shot'}.png`); await page.screenshot({ path: p, fullPage: !!s.full }); report.screenshots.push(p); return p; },
    map: async (s, t) => {
      report.map = await t.evaluate(() => {
        const sel = (e) => (e.id ? `#${e.id}` : e.getAttribute('aria-label') ? `[aria-label="${e.getAttribute('aria-label')}"]` : e.dataset.tab ? `[data-tab="${e.dataset.tab}"]` : e.dataset.add ? `[data-add="${e.dataset.add}"]`
          : e.dataset.export ? `[data-export="${e.dataset.export}"]` : e.dataset.template ? `[data-template="${e.dataset.template}"]`
          : e.dataset.view ? `[data-view="${e.dataset.view}"]` : e.name ? `${e.tagName.toLowerCase()}[name="${e.name}"]` : `text=${(e.innerText || e.value || '').trim().slice(0, 40)}`);
        return [...document.querySelectorAll('button, input, select, textarea, a[href], [role=tab]')]
          .filter((e) => e.offsetParent !== null || e.type === 'file')
          .map((e) => ({ tag: e.tagName.toLowerCase(), type: e.type || undefined, selector: sel(e), text: (e.innerText || e.getAttribute('aria-label') || e.placeholder || e.value || '').trim().slice(0, 60), disabled: e.disabled || undefined }));
      });
      return `${report.map.length} interactive elements`;
    },
  };

  for (const [i, s] of (scenario.steps || []).entries()) {
    const rec = { i, do: s.do, note: s.note, frame: s.frame, ok: true };
    const t0 = Date.now();
    try {
      if (!ACTIONS[s.do]) throw new Error(`unknown step "${s.do}"`);
      const v = await ACTIONS[s.do](s, await scope(s));
      if (v !== undefined) rec.value = v;
    } catch (e) {
      rec.ok = false; rec.error = e.message.split('\n')[0];
      if (!s.soft) report.ok = false;
      try { report.screenshots.push(await ACTIONS.screenshot({ name: `fail-step-${i}` })); } catch {}
    }
    rec.ms = Date.now() - t0;
    report.steps.push(rec);
    console.log(`${rec.ok ? 'ok  ' : s.soft ? 'soft' : 'FAIL'} ${String(i).padStart(2)} ${s.do}${s.sel ? ` ${s.sel}` : ''}${s.js ? ` ${s.js.slice(0, 60)}` : ''}${rec.value !== undefined ? ` → ${JSON.stringify(rec.value).slice(0, 80)}` : ''}${rec.error ? `\n       ${rec.error}` : ''}`);
    if (!rec.ok && !s.soft && !flag('keep-going')) break;
  }
  if (scenario.failOnPageErrors !== false && report.pageErrors.length) report.ok = false;
} catch (e) {
  report.ok = false; report.fatal = e.message;
  console.error('fatal:', e.message);
} finally {
  await browser?.close();
  server?.kill();
  report.finishedAt = new Date().toISOString();
  report.saved = saved;
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  if (report.map) console.log(report.map.map((m) => `  ${m.selector.padEnd(34)} ${m.tag}${m.type ? `[${m.type}]` : ''}  ${m.text}`).join('\n'));
  if (report.pageErrors.length) console.log(`page errors:\n  ${report.pageErrors.join('\n  ')}`);
  console.log(`${report.ok ? 'PASSED' : 'FAILED'}  report: ${resolve(out, 'report.json')}`);
  process.exitCode = report.ok ? 0 : 1;
}
