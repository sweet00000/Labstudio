import { LBM, FLAG, maxCellsFor, lbmBytesPerCell, halfToFloat } from './lbm.js';
import { bounds, robustBounds, tunnelGrid, fitTransform, applyTransform, rasterizeMesh, rasterizeSplats, solidify, dropFloaters, buildTunnel, suggestShrink, grow } from './voxelize.js';
import { surfaceNets, meshStats } from './mesher.js';
import { loadFile } from './loaders.js';
import { makeSample } from './samples.js';
import { toSTL, to3MF, toGLB, toOBJ, toPLYMesh, toSplatPLY, toVTK, toCSV, zip, download, prepareForExport } from './export.js';
import { Renderer } from './render.js';
import { setupCloud } from './cloud.js';

const $ = (id) => document.getElementById(id);
const U_LAT = 0.08;
const FLUIDS = { air: { rho: 1.204, nu: 1.51e-5, name: 'air' }, water: { rho: 998, nu: 1.0e-6, name: 'water' } };
const UNIT = { mm: 1000, m: 1, in: 39.37007874 };

const S = {
  device: null, f16: false, renderer: null, lbm: null,
  scan: null, model: null, name: 'model', tf: null, grid: null, tunnel: null, bodyMask: null, displayMesh: null,
  mPerUnit: 1, running: false, steps: 6, history: [], frame: 0, pendingForce: null,
};

const status = (msg) => { $('status').textContent = msg; };
const fmt = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : '–');
const tick = () => new Promise((r) => setTimeout(r, 0));

// ---------------- boot ----------------
async function boot() {
  applyTheme(localStorage.getItem('st-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'), false);
  if (!navigator.gpu) return noGPU();
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return noGPU();
  S.adapter = adapter; // keep a reference: some browsers lose the device if the adapter is collected
  const feats = adapter.features.has('shader-f16') ? ['shader-f16'] : [];
  S.device = await adapter.requestDevice({
    requiredFeatures: feats,
    requiredLimits: { maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize, maxBufferSize: adapter.limits.maxBufferSize },
  });
  S.f16 = feats.length > 0;
  S.device.lost.then((info) => status(`The GPU stopped responding (${info.message || info.reason}). Reload the page and try a smaller grid.`));
  S.renderer = new Renderer(S.device, $('view'), navigator.gpu.getPreferredCanvasFormat());
  S.renderer.setGrid(160, 64, 76);
  applyTheme(document.documentElement.dataset.theme, false);
  S.renderer.bindControls($('view'));
  const cap = maxCellsFor(S.device.limits, S.f16);
  $('fitInfo').textContent = `This GPU can hold about ${(cap / 1e6).toFixed(1)} million cells${S.f16 ? ' (half-precision storage on)' : ''}.`;
  requestAnimationFrame(loop);
  window.__splattunnel = S; // for debugging and the headless test
}

function noGPU() {
  $('nogpu').hidden = false;
  status('WebGPU isn’t available here.');
}

// ---------------- theme ----------------
function applyTheme(t, save = true) {
  document.documentElement.dataset.theme = t;
  $('themeBtn').textContent = t === 'dark' ? 'Paper' : 'Blueprint';
  if (save) localStorage.setItem('st-theme', t);
  if (!S.renderer) return;
  const cs = getComputedStyle(document.documentElement);
  const v = (k) => cs.getPropertyValue(k).trim();
  S.renderer.setTheme({ bg: v('--view-bg'), ink: v('--ink'), slow: v('--slow'), fast: v('--fast'), neutral: v('--neutral'), body: v('--body'), smoke: v('--smoke') });
}
$('themeBtn').addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));

// Splat scans get floater-proof bounds; meshes use their exact box.
function scanBounds(pos) {
  return S.scan.kind === 'splats' ? robustBounds(pos, S.scan.opacity, +$('minOp').value) : bounds(pos);
}

// ---------------- step 1: load ----------------
async function useScan(scan, name) {
  stop();
  S.scan = scan; S.name = name.replace(/\.[^.]+$/, '') || 'model';
  const b = scanBounds(scan.pos);
  const n = scan.kind === 'mesh' ? `${(scan.idx.length / 3).toLocaleString()} triangles` : `${(scan.pos.length / 3).toLocaleString()} ${scan.points ? 'points' : 'splats'}`;
  $('scanInfo').textContent = `${name}: ${n}, ${b.size.map((v) => +v.toPrecision(3)).join(' × ')} file units.`;
  $('splatOpts').hidden = scan.kind !== 'splats';
  $('expSrc').querySelector('[value="orig"]').disabled = scan.kind !== 'mesh';
  if (scan.kind !== 'mesh') $('expSrc').value = 'solid';
  if (scan.meta) { $('realLen').value = scan.meta.length; $('ground').checked = scan.meta.ground; $('upAxis').value = scan.meta.upAxis || 'y'; }
  else $('realLen').value = +Math.max(...b.size).toPrecision(3);
  $('buildBtn').disabled = false;
  S.tunnel = null; S.bodyMask = null;
  enableRun(false); enableExport();
  preview();
  status('Check the size and orientation, then build the solid.');
}

$('file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  status(`Reading ${f.name}…`);
  await tick();
  try { await useScan(await loadFile(f), f.name); } catch (err) { status(err.message); }
});
const drop = $('drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', async (e) => {
  e.preventDefault(); drop.classList.remove('over');
  const f = e.dataTransfer.files[0];
  if (!f) return;
  status(`Reading ${f.name}…`); await tick();
  try { await useScan(await loadFile(f), f.name); } catch (err) { status(err.message); }
});
async function loadSample(name) {
  status('Building the sample shape…'); await tick();
  const s = makeSample(name);
  await useScan(s, `${s.meta.label.toLowerCase()}.stl`);
  await buildSolid();
}
document.querySelectorAll('[data-sample]').forEach((b) => b.addEventListener('click', () => loadSample(b.dataset.sample)));

// LabStudio hands models over from the CAD workspace (same origin only):
// { type: 'labstudio:mesh', name, pos: Float32Array (mm, Z up), idx: Uint32Array }
async function receiveMesh(m) {
  const b = bounds(m.pos);
  const meta = { label: m.name, length: Math.max(...b.size) / 1000, ground: m.ground ?? true, upAxis: 'z' };
  await useScan({ kind: 'mesh', pos: m.pos, idx: m.idx, col: null, meta }, `${m.name}.stl`);
  if (S.device) await buildSolid();
}
const pendingMeshes = [];
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || e.data?.type !== 'labstudio:mesh') return;
  if (S.device) receiveMesh(e.data).catch((err) => status(err.message)); else pendingMeshes.push(e.data);
});

// ---------------- step 2: orient, fit, voxelize ----------------
// Rotate file coordinates into tunnel axes (x = downstream, y = up).
function orient(pos) {
  const up = $('upAxis').value, yaw = (+$('yaw').value || 0) * Math.PI / 180;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    let x = pos[i], y = pos[i + 1], z = pos[i + 2];
    if (up === 'z') [y, z] = [z, -y];
    else if (up === '-y') [y, z] = [-y, -z];
    out[i] = c * x + s * z; out[i + 1] = y; out[i + 2] = -s * x + c * z;
  }
  return out;
}

function gridFor(b, bodyCells, ground) {
  const cap = maxCellsFor(S.device.limits, S.f16);
  let g = tunnelGrid(b, bodyCells, ground);
  while (g.nx * g.ny * g.nz > cap && bodyCells > 12) { bodyCells -= 4; g = tunnelGrid(b, bodyCells, ground); }
  return g;
}

function preview() {
  if (!S.scan || !S.renderer) return;
  const pos = orient(S.scan.pos);
  const ground = $('ground').checked;
  const b = scanBounds(pos);
  const g = gridFor(b, +$('res').value, ground);
  const tf = fitTransform(b, g.nx, g.ny, g.nz, { bodyCells: g.bodyCells, ground, x0: g.x0 });
  S.renderer.setGrid(g.nx, g.ny, g.nz);
  S.renderer.attachSolver(null);
  const lat = applyTransform(pos, tf);
  if (S.scan.kind === 'mesh') { S.renderer.setPoints(null); S.renderer.setMesh(lat, S.scan.idx); }
  else {
    S.renderer.setMesh(null, null);
    const n = lat.length / 3, step = Math.max(1, Math.ceil(n / 300000));
    const p = new Float32Array(Math.ceil(n / step) * 3), c = new Uint8Array(Math.ceil(n / step) * 4);
    for (let i = 0, k = 0; i < n; i += step, k++) { p.set(lat.subarray(3 * i, 3 * i + 3), 3 * k); c.set(S.scan.col.subarray(4 * i, 4 * i + 4), 4 * k); }
    S.renderer.setPoints(p, c);
  }
  const mem = (g.nx * g.ny * g.nz * lbmBytesPerCell(S.f16) / 2 ** 20).toFixed(0);
  $('fitInfo').textContent = `Tunnel ${g.nx} × ${g.ny} × ${g.nz} cells (${((g.nx * g.ny * g.nz) / 1e6).toFixed(2)} M), about ${mem} MB of GPU memory. One cell is ${fmtLen(+$('realLen').value / g.bodyCells)}.`;
}
['upAxis', 'yaw', 'res', 'ground', 'realLen'].forEach((id) => $(id).addEventListener('change', () => { if (S.scan) { stop(); S.tunnel = null; enableRun(false); enableExport(); preview(); } }));

const fmtLen = (m) => (m >= 1 ? `${m.toPrecision(3)} m` : m >= 0.01 ? `${(m * 100).toPrecision(3)} cm` : `${(m * 1000).toPrecision(3)} mm`);

async function buildSolid() {
  if (!S.scan) return;
  stop();
  status('Building the solid…'); await tick();
  const t0 = performance.now();
  const ground = $('ground').checked;
  const pos = orient(S.scan.pos);
  const b = scanBounds(pos);
  const g = gridFor(b, +$('res').value, ground);
  const { nx, ny, nz } = g;
  const tf = fitTransform(b, nx, ny, nz, { bodyCells: g.bodyCells, ground, x0: g.x0 });
  const lat = applyTransform(pos, tf);
  const frac = (+$('floater').value || 0) / 100;
  let solid, info = '';
  if (S.scan.kind === 'mesh') {
    const surf = rasterizeMesh(lat, S.scan.idx, nx, ny, nz);
    solid = solidify(surf, nx, ny, nz, 1, 0);
    const cl = dropFloaters(solid, nx, ny, nz, frac);
    solid = cl.mask;
  } else {
    const n = lat.length / 3;
    const radii = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const s = [S.scan.scale[3 * i], S.scan.scale[3 * i + 1], S.scan.scale[3 * i + 2]].sort((a, c) => a - c);
      radii[i] = 1.5 * s[1] * tf.scale;
    }
    const minOp = +$('minOp').value;
    const surf = rasterizeSplats(lat, radii, S.scan.opacity, nx, ny, nz, { minOpacity: minOp });
    const cl = dropFloaters(surf, nx, ny, nz, frac);
    const shrink = suggestShrink(radii, S.scan.opacity, minOp);
    solid = solidify(cl.mask, nx, ny, nz, +$('closeGaps').value, shrink);
    info = ` Dropped ${cl.removed.toLocaleString()} floater cells.`;
    S.splatLat = lat;
  }
  S.mPerUnit = (+$('realLen').value || 1) / (Math.max(...b.size) || 1);
  S.tf = tf; S.grid = g; S.oriented = pos;
  S.tunnel = buildTunnel(solid, nx, ny, nz, { ground });
  S.bodyMask = new Uint8Array(S.tunnel.flags.length);
  for (let i = 0; i < S.bodyMask.length; i++) S.bodyMask[i] = S.tunnel.flags[i] === FLAG.BODY ? 1 : 0;
  if (!S.tunnel.bodyCount) { status('Nothing solid was left after cleanup. Lower the faint-splat cutoff or the floater size, then try again.'); return; }
  const m = surfaceNets(S.bodyMask, nx, ny, nz);
  S.displayMesh = m;
  S.renderer.setPoints(null);
  S.renderer.setMesh(m.pos, m.idx);
  S.renderer.setGrid(nx, ny, nz);
  const st = meshStats(m.pos, m.idx);
  const cell = 1 / tf.scale * S.mPerUnit;
  const warn = S.tunnel.blockage > 0.1 ? ' Blockage is above 10%, which inflates drag. Turn the model so its narrow side faces the wind if that fits your test.' : '';
  $('fitInfo').textContent = `Solid: ${S.tunnel.bodyCount.toLocaleString()} cells, frontal area ${(S.tunnel.frontalArea * cell * cell).toPrecision(3)} m\u00b2, tunnel blockage ${(100 * S.tunnel.blockage).toFixed(1)}%.${info}${warn}`;
  $('expInfo').textContent = `Watertight solid ready: ${st.triangles.toLocaleString()} triangles${st.watertight ? ', closed and manifold' : ''}.`;
  await setupSolver();
  status(`Solid built in ${((performance.now() - t0) / 1000).toFixed(1)} s. Press Run.`);
  enableRun(true); enableExport();
}
$('buildBtn').addEventListener('click', () => buildSolid().catch((e) => status(e.message)));

// ---------------- step 3: solver ----------------
function physics() {
  const V = +$('speed').value || 30;
  const fl = FLUIDS[$('fluid').value];
  const L = +$('realLen').value || 1;
  const Re = V * L / fl.nu;
  const nuLat = Math.max(U_LAT * S.grid.bodyCells / Re, 2e-4);
  return { V, fl, L, Re, nuLat, ReSim: U_LAT * S.grid.bodyCells / nuLat };
}

async function setupSolver() {
  S.lbm?.destroy();
  S.renderer.attachSolver(null);
  const { nx, ny, nz } = S.grid;
  S.lbm = new LBM(S.device, { nx, ny, nz, f16: S.f16 });
  await S.lbm.build();
  const ph = physics();
  S.lbm.setPhysics({ nu: ph.nuLat, cs: 0.17, u: [U_LAT, 0, 0] });
  S.lbm.setFlags(S.tunnel.flags);
  S.lbm.setBoundaryCells(S.tunnel.boundaryCells);
  S.lbm.reset();
  S.renderer.u0 = U_LAT;
  S.renderer.attachSolver(S.lbm, S.grid.nx * S.grid.ny * S.grid.nz > 2e6 ? 16384 : 24576);
  S.history = []; S.flowReady = false;
  $('slice').dispatchEvent(new Event('input'));
  $('runInfo').textContent = `Real Reynolds number ${ph.Re.toExponential(1)}; the grid resolves about ${ph.ReSim.toExponential(1)} with a turbulence model filling the gap.`;
  showGauges();
}

function stop() { S.running = false; $('runBtn').textContent = 'Run'; }
$('runBtn').addEventListener('click', () => {
  if (!S.lbm) return;
  S.running = !S.running;
  $('runBtn').textContent = S.running ? 'Pause' : 'Run';
  $('legend').hidden = false;
  if (S.running) status('Running. Drag to orbit, pinch or scroll to zoom.');
});
$('resetBtn').addEventListener('click', () => { if (S.lbm) { S.lbm.reset(); S.history = []; S.flowReady = false; showGauges(); } });
['speed', 'fluid'].forEach((id) => $(id).addEventListener('change', () => {
  if (!S.lbm) return;
  const ph = physics();
  S.lbm.setPhysics({ nu: ph.nuLat, cs: 0.17, u: [U_LAT, 0, 0] });
  S.history = [];
  $('runInfo').textContent = `Real Reynolds number ${ph.Re.toExponential(1)}; the grid resolves about ${ph.ReSim.toExponential(1)} with a turbulence model filling the gap.`;
}));
$('slice').addEventListener('input', () => { if (S.grid) S.renderer.sliceZ = 1 + (+$('slice').value) * (S.grid.nz - 3); });
$('showSlice').addEventListener('change', (e) => { S.renderer.showSlice = e.target.checked; });
$('showSmoke').addEventListener('change', (e) => { S.renderer.showTracers = e.target.checked; });

function enableRun(on) { $('runBtn').disabled = !on; $('resetBtn').disabled = !on; if (!on) stop(); }

// averaged coefficients after the flow has crossed the tunnel once
function coeffs() {
  if (!S.history.length) return null;
  const settle = S.grid.nx / U_LAT;
  const last = S.history.filter((h) => h.step > settle);
  const use = last.length >= 3 ? last.slice(-30) : null;
  if (!use) return { settling: true, progress: S.history.at(-1).step / settle };
  const avg = (k) => use.reduce((s, h) => s + h[k], 0) / use.length;
  return { cd: avg('cd'), cl: avg('cl'), cs: avg('cs') };
}

function showGauges() {
  const c = coeffs();
  if (!c) { $('gCd').textContent = $('gCl').textContent = $('gF').textContent = '–'; return; }
  if (c.settling) {
    $('gCd').textContent = $('gCl').textContent = $('gF').textContent = '–';
    if (S.running) status(`Settling: the wind has crossed ${Math.min(99, Math.round(100 * c.progress))}% of the tunnel. Readings start after one full pass.`);
    return;
  }
  if (S.running && /^Settling/.test($('status').textContent)) status('Running. Drag to orbit, pinch or scroll to zoom.');
  const ph = physics();
  const cell = S.mPerUnit / S.tf.scale;
  const A = S.tunnel.frontalArea * cell * cell;
  const F = 0.5 * ph.fl.rho * ph.V * ph.V * c.cd * A;
  $('gCd').textContent = fmt(c.cd, 2);
  $('gCl').textContent = fmt(c.cl, 2);
  $('gF').textContent = F >= 1000 ? `${(F / 1000).toFixed(2)} kN` : `${F.toPrecision(3)} N`;
}

let lastT = 0;
function loop(t) {
  requestAnimationFrame(loop);
  if (!S.renderer) return;
  const dt = t - lastT; lastT = t;
  const enc = S.device.createCommandEncoder();
  let steps = 0;
  if (S.running && S.lbm) {
    if (dt > 45 && S.steps > 1) S.steps--; else if (dt < 25 && S.steps < 40) S.steps++;
    steps = S.steps;
    S.lbm.encodeSteps(enc, steps);
    S.flowReady = true;
    if (++S.frame % 8 === 0 && !S.pendingForce) S.pendingForce = S.lbm.encodeForce(enc);
  }
  if (S.lbm && S.flowReady) S.lbm.encodeMacro(enc);
  S.renderer.frame(enc, { stepsPerFrame: steps, flowReady: !!(S.lbm && S.flowReady) });
  S.device.queue.submit([enc.finish()]);
  const pf = S.pendingForce;
  if (pf && !pf.reading) {
    pf.reading = true;
    const step = S.lbm.stepCount, A = S.tunnel.frontalArea, lbm = S.lbm;
    lbm.readForce(pf).then((F) => {
      S.pendingForce = null;
      if (lbm !== S.lbm) return;
      const q = 0.5 * U_LAT * U_LAT * A;
      if ([F[0], F[1], F[2]].some((v) => !Number.isFinite(v))) { stop(); status('The flow became unstable. Lower the wind speed, use a finer grid, or restart the flow.'); return; }
      S.history.push({ step, cd: F[0] / q, cl: F[1] / q, cs: F[2] / q });
      showGauges();
      enableExport();
    }).catch(() => { S.pendingForce = null; });
  }
}

// ---------------- step 4: export ----------------
function enableExport() {
  const solid = !!S.bodyMask;
  const src = $('expSrc').value;
  document.querySelectorAll('[data-fmt]').forEach((b) => {
    const f = b.dataset.fmt;
    let on = false;
    if (['stl', '3mf', 'glb', 'obj', 'ply'].includes(f)) on = src === 'orig' ? S.scan?.kind === 'mesh' : solid;
    if (f === 'splat') on = S.scan?.kind === 'splats' && solid;
    if (f === 'vtk') on = !!(S.lbm && S.flowReady);
    if (f === 'csv') on = S.history.length > 0;
    if (f === 'zip') on = solid;
    b.disabled = !on;
  });
}
$('expSrc').addEventListener('change', enableExport);

// geometry in meters, tunnel-aligned (x downstream, y up)
function exportMeshMeters(src) {
  if (src === 'orig' && S.scan.kind === 'mesh') {
    const p = S.oriented || orient(S.scan.pos);
    const out = new Float32Array(p.length);
    for (let i = 0; i < p.length; i++) out[i] = p[i] * S.mPerUnit;
    return { pos: out, idx: S.scan.idx, col: S.scan.col };
  }
  const m = S.displayMesh;
  const out = new Float32Array(m.pos.length);
  for (let i = 0; i < m.pos.length; i += 3) for (let k = 0; k < 3; k++) out[i + k] = (m.pos[i + k] - S.tf.offset[k]) / S.tf.scale * S.mPerUnit;
  return { pos: out, idx: m.idx, col: null };
}

function geometryFile(fmtName) {
  const unit = $('expUnit').value;
  const scale = UNIT[unit] * (+$('expScale').value);
  const mesh = prepareForExport(exportMeshMeters($('expSrc').value), { scale, zUp: $('zUp').checked });
  const c = coeffs();
  const suffix = +$('expScale').value === 1 ? '' : `_1to${Math.round(1 / +$('expScale').value)}`;
  const base = `${S.name}${suffix}_${unit}`;
  switch (fmtName) {
    case 'stl': return [toSTL(mesh, S.name), `${base}.stl`, 'model/stl'];
    case '3mf': return [to3MF(mesh, { unit: { mm: 'millimeter', m: 'meter', in: 'inch' }[unit], name: S.name }), `${base}.3mf`, 'model/3mf'];
    case 'glb': return [toGLB([{ name: S.name, ...mesh, color: [0.62, 0.66, 0.62, 1] }], { extras: { units: unit, scale: +$('expScale').value, cd: c?.cd ?? null, cl: c?.cl ?? null, windSpeed_mps: +$('speed').value, generator: 'splattunnel' } }), `${base}.glb`, 'model/gltf-binary'];
    case 'obj': return [toOBJ(mesh, S.name), `${base}.obj`, 'text/plain'];
    case 'ply': return [toPLYMesh(mesh), `${base}.ply`, 'application/octet-stream'];
  }
  return null;
}

function splatFile() {
  const { nx, ny, nz } = S.grid;
  const near = grow(S.bodyMask, nx, ny, nz, 2);
  const n = S.splatLat.length / 3;
  const keep = new Uint8Array(n);
  let kept = 0;
  for (let i = 0; i < n; i++) {
    const x = Math.round(S.splatLat[3 * i]), y = Math.round(S.splatLat[3 * i + 1]), z = Math.round(S.splatLat[3 * i + 2]);
    if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) continue;
    if (near[x + nx * (y + ny * z)]) { keep[i] = 1; kept++; }
  }
  $('expInfo').textContent = `Kept ${kept.toLocaleString()} of ${n.toLocaleString()} splats, in the original file coordinates.`;
  return [toSplatPLY(S.scan, keep), `${S.name}_cleaned.ply`, 'application/octet-stream'];
}

async function vtkFile() {
  const { nx, ny, nz } = S.grid;
  const n = nx * ny * nz;
  const raw = await S.lbm.readVelocity();
  const ph = physics();
  const k = ph.V / U_LAT;
  const pk = ph.fl.rho * ph.V * ph.V / (3 * U_LAT * U_LAT);
  const vel = new Float32Array(3 * n), p = new Float32Array(n);
  for (let c = 0; c < n; c++) {
    vel[3 * c] = halfToFloat(raw[4 * c]) * k; vel[3 * c + 1] = halfToFloat(raw[4 * c + 1]) * k; vel[3 * c + 2] = halfToFloat(raw[4 * c + 2]) * k;
    p[c] = halfToFloat(raw[4 * c + 3]) * pk;
  }
  const cell = S.mPerUnit / S.tf.scale;
  const origin = S.tf.offset.map((o) => -o / S.tf.scale * S.mPerUnit);
  return [toVTK({ nx, ny, nz, spacing: cell, origin, vel, p, flags: S.tunnel.flags }), `${S.name}_flow.vtk`, 'application/octet-stream'];
}

function csvFile() {
  const ph = physics();
  const cell = S.mPerUnit / S.tf.scale;
  const dtReal = cell * U_LAT / ph.V;
  const rows = S.history.map((h) => [h.step, h.step * dtReal, h.cd, h.cl, h.cs]);
  return [toCSV(rows, ['lattice_step', 'time_s', 'cd', 'cl', 'c_side']), `${S.name}_forces.csv`, 'text/csv'];
}

function summary() {
  const c = coeffs() || {};
  const ph = S.grid ? physics() : null;
  const cell = S.tf ? S.mPerUnit / S.tf.scale : 0;
  return {
    model: S.name, generator: 'Splat Tunnel', date: new Date().toISOString(),
    real_length_m: +$('realLen').value, wind_speed_mps: ph?.V, fluid: ph?.fl.name,
    reynolds_real: ph?.Re, reynolds_simulated: ph?.ReSim,
    grid: S.grid ? [S.grid.nx, S.grid.ny, S.grid.nz] : null, cell_size_m: cell,
    frontal_area_m2: S.tunnel ? S.tunnel.frontalArea * cell * cell : null, blockage: S.tunnel?.blockage,
    cd: c.cd ?? null, cl: c.cl ?? null, c_side: c.cs ?? null,
    note: 'Qualitative lattice Boltzmann result at reduced Reynolds number. Compare shapes; do not certify designs with it.',
  };
}

document.querySelectorAll('[data-fmt]').forEach((b) => b.addEventListener('click', async () => {
  try {
    const f = b.dataset.fmt;
    let out;
    if (['stl', '3mf', 'glb', 'obj', 'ply'].includes(f)) out = geometryFile(f);
    else if (f === 'splat') out = splatFile();
    else if (f === 'vtk') { status('Reading the flow field from the GPU…'); out = await vtkFile(); status('Flow field saved. Open it in ParaView and color by velocity.'); }
    else if (f === 'csv') out = csvFile();
    else if (f === 'zip') {
      const files = [];
      for (const g of ['stl', '3mf', 'glb']) { const [d, name] = geometryFile(g); files.push({ name, data: d }); }
      if (S.scan.kind === 'splats') { const [d, name] = splatFile(); files.push({ name, data: d }); }
      if (S.lbm && S.flowReady) { const [d, name] = await vtkFile(); files.push({ name, data: d }); }
      if (S.history.length) { const [d, name] = csvFile(); files.push({ name, data: d }); }
      files.push({ name: 'summary.json', data: new TextEncoder().encode(JSON.stringify(summary(), null, 2)) });
      out = [zip(files), `${S.name}_splattunnel.zip`, 'application/zip'];
    }
    if (out) download(out[0], out[1], out[2]);
  } catch (err) { status(`Export failed: ${err.message}`); }
}));

setupCloud({
  getSolidSTL: () => (S.bodyMask ? prepareForExport(exportMeshMeters('solid'), { scale: 1 }) : null),
  getSummary: summary,
  onSplatReady: async (buf, name) => { const { parseBuffer } = await import('./loaders.js'); await useScan(parseBuffer(buf, name), name); },
  status,
});

// Start with a model in the tunnel: one handed over before boot finished, else the
// hatchback sample (skip with ?empty).
boot()
  .then(async () => {
    if (!S.device) return;
    if (pendingMeshes.length) await receiveMesh(pendingMeshes.pop());
    else if (!S.scan && !new URLSearchParams(location.search).has('empty')) await loadSample('car');
  })
  .catch((e) => { status(`Couldn’t start the GPU: ${e.message}`); });
