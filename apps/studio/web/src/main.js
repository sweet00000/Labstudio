// LabStudio shell: the Model (CAD) workspace, plus the Optics and Wind tunnel apps in
// frames on the same origin. Models move between them as plain meshes in millimetres.
import Module from '../../../../packages/vendor/manifold/manifold.js';
import { Evaluator, emptyDoc, makeFeature, analyze, meshFromManifold, manifoldFromMesh, placeOnBed, docToJSON, docFromJSON, newId } from './cad.js';
import { birdbathHousing, hatchback } from './templates.js';
import { scanToSolid } from './scan.js';
import { Viewport } from './viewport.js';
import * as store from './store.js';
import { parseBuffer } from '../../../../packages/geometry/loaders.js';
import { bounds } from '../../../../packages/geometry/voxel.js';
import { toSTL, to3MF, toOBJ, toGLB, download } from '../../../../packages/geometry/export.js';
import { projectFromJSON } from '../../../mirrorlab/web/src/physics.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const tick = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }) : '–');

const S = { doc: emptyDoc(), sel: null, past: [], future: [], result: null, ev: null, wasm: null, pending: null, evalMs: 0 };
const view = new Viewport($('view'));

function status(msg, bad = false) { $('status').textContent = msg; $('status').classList.toggle('bad', bad); }

// ---------- theme ----------
function applyTheme() {
  const cs = getComputedStyle(document.documentElement), v = (k) => cs.getPropertyValue(k).trim();
  view.setTheme({ bg: v('--view-bg'), part: v('--part'), grid: v('--grid') });
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
applyTheme();

// ---------- tabs ----------
const FRAMES = { optics: ['../../mirrorlab/web/', 'Mirrorlab optics workbench'], tunnel: ['../../splattunnel/web/', 'Splat Tunnel wind tunnel'] };
function frame(tab) {
  let f = $(`tab-${tab}`).querySelector('iframe');
  if (!f) {
    f = el('iframe', { src: FRAMES[tab][0], title: FRAMES[tab][1] });
    f.loaded = new Promise((r) => f.addEventListener('load', r, { once: true }));
    $(`tab-${tab}`).append(f);
  }
  return f;
}
function showTab(tab) {
  if (!['model', 'optics', 'tunnel'].includes(tab)) tab = 'model';
  document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  for (const t of ['model', 'optics', 'tunnel']) $(`tab-${t}`).hidden = t !== tab;
  if (tab !== 'model') frame(tab); else view.resize();
  history.replaceState(null, '', tab === 'model' ? location.pathname : `#${tab}`);
}
document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

// ---------- optics link ----------
// Mirrorlab keeps its current design in localStorage; same origin, so we can read it.
function currentOptics() {
  try { const s = localStorage.getItem('mirrorlab.project'); return s ? projectFromJSON(s) : undefined; } catch { return undefined; }
}
const hasGroup = (g) => S.doc.features.some((f) => f.group === g);
addEventListener('storage', (e) => { if (e.key === 'mirrorlab.project' && hasGroup('birdbath')) $('opticsBanner').hidden = false; });
$('opticsUpdate').addEventListener('click', () => { applyBirdbath(); $('opticsBanner').hidden = true; });
$('xray').addEventListener('change', () => view.setXray($('xray').checked));

// Rebuild the birdbath features in place (keeping the user's own), or with `fresh`
// start a new model from the template.
function applyBirdbath(fresh = false) {
  const made = birdbathHousing(currentOptics());
  edit(() => {
    const at = S.doc.features.findIndex((f) => f.group === 'birdbath');
    const keep = fresh ? [] : S.doc.features.filter((f) => f.group !== 'birdbath');
    keep.splice(at < 0 ? keep.length : at, 0, ...made);
    S.doc.features = keep;
    S.sel = null;
  });
  if (fresh) view.setXray($('xray').checked = true);
  status('Birdbath housing built from the current Optics design. Blue bodies are the mirror, splitter, display and eye.');
}

function applyHatchback() {
  const h = hatchback(), id = newId('a');
  S.doc.assets[id] = h.asset;
  const f = makeFeature('mesh', { ...h.feature, params: { asset: id, scale: 1 } });
  edit(() => { S.doc.features = [f]; S.sel = null; });
  view.setXray($('xray').checked = false);
  status('Hatchback added, 4.2 m long. Send it to the wind tunnel, or cut and add to it first.');
}

// ---------- editing and history ----------
function edit(fn) {
  const before = JSON.stringify(S.doc.features);
  fn();
  if (JSON.stringify(S.doc.features) === before) return refresh();
  S.past.push(before); if (S.past.length > 200) S.past.shift();
  S.future = [];
  refresh();
  autosave();
}
function undo(dir) {
  const [from, to] = dir < 0 ? [S.past, S.future] : [S.future, S.past];
  if (!from.length) return;
  to.push(JSON.stringify(S.doc.features));
  S.doc.features = JSON.parse(from.pop());
  if (!S.doc.features.some((f) => f.id === S.sel)) S.sel = null;
  refresh(); autosave();
}
$('undoBtn').addEventListener('click', () => undo(-1));
$('redoBtn').addEventListener('click', () => undo(1));
addEventListener('keydown', (e) => {
  if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName) || $('tab-model').hidden) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(e.shiftKey ? 1 : -1); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); undo(1); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel) { e.preventDefault(); removeFeature(S.sel); }
});

let saveTimer;
function autosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const used = new Set(S.doc.features.filter((f) => f.type === 'mesh').map((f) => f.params.asset));
    const assets = Object.fromEntries(Object.entries(S.doc.assets).filter(([id]) => used.has(id)));
    store.put('project', { ...S.doc, assets });
  }, 400);
}

const feature = (id) => S.doc.features.find((f) => f.id === id);
function removeFeature(id) { edit(() => { S.doc.features = S.doc.features.filter((f) => f.id !== id); if (S.sel === id) S.sel = null; }); }
function moveFeature(id, d) {
  edit(() => {
    const a = S.doc.features, i = a.findIndex((f) => f.id === id), j = i + d;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
  });
}

// ---------- evaluation ----------
let evalQueued = false;
function refresh() {
  renderProps();
  if (evalQueued) return;
  evalQueued = true;
  requestAnimationFrame(() => { evalQueued = false; evaluate(); renderTree(); });
}

function evaluate() {
  if (!S.ev) return;
  const t0 = performance.now();
  const r = S.ev.evaluate(S.doc);
  S.result?.part?.delete(); S.result?.reference?.delete();
  S.result = r;
  view.set('part', r.part && !r.part.isEmpty() ? meshFromManifold(r.part) : null);
  view.set('reference', $('showRef').checked && r.reference && !r.reference.isEmpty() ? meshFromManifold(r.reference) : null);
  const f = feature(S.sel);
  let selMesh = null;
  if (f && f.visible && !r.errors[f.id]) { const s = S.ev.solid(f, S.doc.assets); selMesh = meshFromManifold(s); s.delete(); }
  view.set('selection', selMesh);
  S.evalMs = performance.now() - t0;
  renderStats();
  const nErr = Object.keys(r.errors).length;
  if (nErr) status(`${nErr} feature${nErr > 1 ? 's have' : ' has'} a problem; see the list.`, true);
  else if ($('status').classList.contains('bad') || /^Rebuilt|^Loading/.test($('status').textContent)) status(`Rebuilt ${S.doc.features.length} features in ${S.evalMs.toFixed(0)} ms.`);
}
$('showRef').addEventListener('change', evaluate);

function renderStats() {
  const a = analyze(S.result?.part, +$('material').value);
  const rows = a ? [
    ['Volume', `${fmt(a.volume / 1000, 2)} cm³`], ['Surface', `${fmt(a.area / 100, 1)} cm²`],
    ['Size', a.size.map((v) => fmt(v, 1)).join(' × ') + ' mm'], ['Mass', `${fmt(a.massG, 1)} g`],
    ['Triangles', a.triangles.toLocaleString()], ['Solid', `closed${a.genus ? `, ${a.genus} through-hole${a.genus > 1 ? 's' : ''}` : ''}`],
  ] : [['Part', 'none yet']];
  $('stats').replaceChildren(...rows.flatMap(([k, v]) => [el('dt', { textContent: k }), el('dd', { textContent: v })]));
}
$('material').addEventListener('change', renderStats);

// ---------- feature list ----------
const OP_GLYPH = { add: '+', subtract: '−', intersect: '∩' };
const GROUP_LABEL = { birdbath: 'Birdbath housing', hatchback: 'Hatchback' };
function renderTree() {
  const items = [];
  let group;
  for (const f of S.doc.features) {
    if (f.group !== group) { group = f.group; if (group) items.push(el('li', { className: 'group', textContent: GROUP_LABEL[group] || group })); }
    const eye = el('button', { className: 'eye', textContent: f.visible ? '◉' : '○', title: f.visible ? 'Hide' : 'Show', ariaLabel: f.visible ? `Hide ${f.name}` : `Show ${f.name}` });
    eye.addEventListener('click', (e) => { e.stopPropagation(); edit(() => { f.visible = !f.visible; }); });
    const name = el('span', { className: 'name', textContent: f.name });
    if (f.role === 'reference') name.append(el('span', { className: 'tag', textContent: 'ref' }));
    const li = el('li', { className: `${f.id === S.sel ? 'sel' : ''} ${f.visible ? '' : 'hidden-f'}`, tabIndex: 0 },
      el('span', { className: `op ${f.op}`, textContent: OP_GLYPH[f.op], title: f.op }), name, eye);
    const err = S.result?.errors?.[f.id];
    if (err) li.append(el('span', { className: 'err', textContent: err }));
    const pick = () => { S.sel = S.sel === f.id ? null : f.id; refresh(); };
    li.addEventListener('click', pick);
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    items.push(li);
  }
  if (!S.doc.features.length) items.push(el('li', { className: 'group', textContent: 'Empty. Add a shape, import a scan, or start from a template.' }));
  $('tree').replaceChildren(...items);
  $('undoBtn').disabled = !S.past.length; $('redoBtn').disabled = !S.future.length;
}

// ---------- properties ----------
const PARAM_LABEL = {
  box: { x: 'Width (X)', y: 'Depth (Y)', z: 'Height (Z)' },
  cylinder: { radius: 'Bottom radius', top: 'Top radius', height: 'Height' },
  sphere: { radius: 'Radius' },
  mesh: { scale: 'Scale' },
};
function numInput(value, onSet, unit = 'mm', axis = false) {
  const i = el('input', { type: 'number', step: 'any', value: +value.toFixed(4), ariaLabel: unit });
  i.addEventListener('change', () => { const v = parseFloat(i.value); if (Number.isFinite(v)) edit(() => onSet(v)); else i.value = value; });
  return el('span', { className: axis ? 'inp axis' : 'inp' }, i, el('em', { textContent: unit }));
}
function renderProps() {
  const f = feature(S.sel), box = $('props');
  if (!f) { box.replaceChildren(el('h2', { textContent: 'Properties' }), el('p', { className: 'note', textContent: 'Select a feature to edit it.' })); return; }
  const name = el('input', { value: f.name, ariaLabel: 'Feature name' });
  name.addEventListener('change', () => edit(() => { f.name = name.value.trim() || f.name; }));
  const seg = el('div', { className: 'seg', role: 'group', ariaLabel: 'Operation' }, ...['add', 'subtract', 'intersect'].map((op) => {
    const b = el('button', { textContent: { add: '+ Add', subtract: '− Cut', intersect: '∩ Keep' }[op], ariaPressed: String(f.op === op) });
    b.addEventListener('click', () => edit(() => { f.op = op; }));
    return b;
  }));
  const role = el('select', { ariaLabel: 'Role' }, el('option', { value: 'part', textContent: 'Part' }), el('option', { value: 'reference', textContent: 'Reference' }));
  role.value = f.role;
  role.addEventListener('change', () => edit(() => { f.role = role.value; }));
  const form = el('div', { className: 'form' }, el('label', { textContent: 'Name' }), name, el('label', { textContent: 'Role' }), role);
  for (const [k, label] of Object.entries(PARAM_LABEL[f.type])) form.append(el('label', { textContent: label }), numInput(f.params[k], (v) => { f.params[k] = v; }, k === 'scale' ? '×' : 'mm'));
  const xyz = (arr, unit) => el('div', { className: 'xyz full' }, ...[0, 1, 2].map((k) => numInput(arr[k], (v) => { arr[k] = v; }, ['X', 'Y', 'Z'][k] + (unit === '°' ? '°' : ''), true)));
  form.append(el('label', { className: 'full', textContent: 'Position (mm)' }), xyz(f.at, 'mm'), el('label', { className: 'full', textContent: 'Rotation (degrees, about X then Y then Z)' }), xyz(f.rot, '°'));
  const btn = (text, fn, cls = 'quiet') => { const b = el('button', { textContent: text, className: cls }); b.addEventListener('click', fn); return b; };
  const actions = el('div', { className: 'row' },
    btn('Duplicate', () => { const c = { ...structuredClone(f), id: newId(), name: `${f.name} copy` }; delete c.group; edit(() => { S.doc.features.splice(S.doc.features.indexOf(f) + 1, 0, c); S.sel = c.id; }); }),
    btn('↑', () => moveFeature(f.id, -1)), btn('↓', () => moveFeature(f.id, 1)),
    btn('Delete', () => removeFeature(f.id)));
  const kids = [el('h2', { textContent: 'Properties' }), seg, form, actions];
  if (f.type === 'mesh') {
    const a = S.doc.assets[f.params.asset];
    if (a) kids.splice(2, 0, el('p', { className: 'note', textContent: `${a.name}: ${(a.idx.length / 3).toLocaleString()} triangles${a.note ? `. ${a.note}` : ''}` }));
  }
  if (f.group === 'birdbath') kids.push(el('p', { className: 'note', textContent: 'Part of the birdbath housing, sized from the Optics design. Regenerating replaces these features and keeps your own.' }), btn('Regenerate from Optics', () => applyBirdbath(), 'quiet'));
  box.replaceChildren(...kids);
  seg.style.marginBottom = '4px';
}

// ---------- add ----------
document.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
  const f = makeFeature(b.dataset.add);
  const a = analyze(S.result?.part);
  if (a) f.at = [(a.min[0] + a.max[0]) / 2, (a.min[1] + a.max[1]) / 2, a.max[2]]; // drop it on top of the part
  edit(() => { S.doc.features.push(f); S.sel = f.id; });
}));
$('newBtn').addEventListener('click', () => { edit(() => { S.doc.features = []; S.sel = null; }); status('Blank model. Undo brings the last one back.'); });
document.querySelectorAll('[data-template]').forEach((b) => b.addEventListener('click', async () => {
  if (b.dataset.template === 'birdbath') applyBirdbath(true); else applyHatchback();
  await tick(); view.fit();
}));

// ---------- import ----------
$('importBtn').addEventListener('click', () => $('scanFile').click());
$('scanFile').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) readScan(f); });
$('view').addEventListener('dragover', (e) => e.preventDefault());
$('view').addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) readScan(f); });

async function readScan(file) {
  status(`Reading ${file.name}…`); await tick();
  try {
    const scan = parseBuffer(await file.arrayBuffer(), file.name);
    const b = bounds(scan.pos), big = Math.max(...b.size);
    S.pending = { scan, name: file.name.replace(/\.[^.]+$/, '') };
    const count = scan.kind === 'mesh' ? `${(scan.idx.length / 3).toLocaleString()} triangles` : `${(scan.pos.length / 3).toLocaleString()} ${scan.points ? 'points' : 'splats'}`;
    $('importInfo').textContent = `${file.name}: ${count}, ${b.size.map((v) => +v.toPrecision(3)).join(' × ')} in file units.${scan.kind === 'mesh' ? '' : ' It will be rebuilt into a closed solid.'}`;
    $('impUnit').value = scan.kind === 'mesh' ? (big < 5 ? 'm' : 'mm') : 'm';
    $('impUp').value = scan.kind === 'mesh' && /\.stl$/i.test(file.name) ? 'z' : 'y';
    $('impRepair').value = 'auto';
    $('importPanel').hidden = false;
    $('importPanel').scrollIntoView({ block: 'nearest' });
    status('Check the units and up axis, then add it to the model.');
  } catch (err) { status(err.message, true); }
}
$('impCancel').addEventListener('click', () => { S.pending = null; $('importPanel').hidden = true; status('Import cancelled.'); });
$('impGo').addEventListener('click', async () => {
  if (!S.pending) return;
  status('Building a solid from the scan…'); await tick();
  try {
    const { scan, name } = S.pending;
    const tryExact = (pos, idx) => { try { const m = manifoldFromMesh(S.wasm, pos, idx); const ok = !m.isEmpty(); m.delete(); return ok; } catch { return false; } };
    const r = scanToSolid(scan, { unit: $('impUnit').value, up: $('impUp').value, fitMm: +$('impFit').value || 0, cells: +$('impCells').value || 112, repair: $('impRepair').value, tryExact });
    const id = newId('a');
    S.doc.assets[id] = { name, source: name, pos: r.pos, idx: r.idx, note: r.note };
    const f = makeFeature('mesh', { name, role: $('impRole').value, params: { asset: id, scale: 1 } });
    edit(() => { S.doc.features.push(f); S.sel = f.id; });
    S.pending = null; $('importPanel').hidden = true;
    await tick(); view.fit();
    status(`${name} added. ${r.note}`);
  } catch (err) { status(err.message, true); }
});

// ---------- output ----------
const baseName = () => (S.doc.features.find((f) => f.role === 'part' && f.group)?.group || S.doc.features.find((f) => f.role === 'part')?.name || 'part').toLowerCase().replace(/[^a-z0-9]+/g, '-');
function partMesh(bed = $('onBed').checked) {
  const p = S.result?.part;
  if (!p || p.isEmpty()) throw new Error('There’s no part yet. Add a feature with the Part role.');
  const m = meshFromManifold(p);
  return bed ? placeOnBed(m) : m;
}
document.querySelectorAll('[data-export]').forEach((b) => b.addEventListener('click', () => {
  try {
    const kind = b.dataset.export, m = partMesh(), name = baseName();
    if (kind === 'stl') download(toSTL(m, name), `${name}.stl`, 'model/stl');
    else if (kind === '3mf') download(to3MF(m, { unit: 'millimeter', name }), `${name}.3mf`, 'model/3mf');
    else if (kind === 'obj') download(toOBJ(m, name), `${name}.obj`, 'text/plain');
    else {
      // glTF is metres with Y up.
      const pos = new Float32Array(m.pos.length);
      for (let i = 0; i < pos.length; i += 3) { pos[i] = m.pos[i] / 1000; pos[i + 1] = m.pos[i + 2] / 1000; pos[i + 2] = -m.pos[i + 1] / 1000; }
      download(toGLB([{ name, pos, idx: m.idx }], { extras: { generator: 'LabStudio' } }), `${name}.glb`, 'model/gltf-binary');
    }
    status(`Saved ${name}.${kind} (millimetres${kind === 'glb' ? ', converted to metres for glTF' : ''}).`);
  } catch (err) { status(err.message, true); }
}));

$('toTunnel').addEventListener('click', async () => {
  try {
    const m = partMesh(false);
    const f = frame('tunnel');
    showTab('tunnel');
    await f.loaded;
    f.contentWindow.postMessage({ type: 'labstudio:mesh', name: baseName(), pos: m.pos, idx: m.idx, ground: true }, location.origin);
  } catch (err) { status(err.message, true); }
});
$('shotBtn').addEventListener('click', () => { const a = el('a', { href: view.png(), download: `${baseName()}.png` }); a.click(); });

// ---------- views ----------
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => view.view(b.dataset.view)));
$('fitBtn').addEventListener('click', () => view.fit());

// ---------- project files ----------
$('saveBtn').addEventListener('click', () => download(docToJSON(S.doc), 'labstudio-project.json', 'application/json'));
$('openBtn').addEventListener('click', () => $('projectFile').click());
$('projectFile').addEventListener('change', async (e) => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  try {
    const text = await file.text(), raw = JSON.parse(text);
    if (raw.schema === 'mirrorlab.project') {
      projectFromJSON(text); // validates
      localStorage.setItem('mirrorlab.project', text);
      $('tab-optics').querySelector('iframe')?.contentWindow.location.reload();
      applyBirdbath();
      status('Optics design opened, and the birdbath housing was rebuilt around it.');
    } else {
      const doc = docFromJSON(raw);
      edit(() => { S.doc.features = doc.features; Object.assign(S.doc.assets, doc.assets); S.sel = null; });
      status(`Opened ${file.name}.`);
    }
    await tick(); view.fit();
  } catch (err) { status(`Couldn’t open that file: ${err.message}`, true); }
});

// ---------- boot ----------
async function boot() {
  const wasm = await Module();
  wasm.setup();
  S.wasm = wasm; S.ev = new Evaluator(wasm);
  const saved = await store.get('project');
  if (saved?.features?.length) {
    S.doc = { ...emptyDoc(), ...saved };
    status('Restored your last model.');
  } else {
    S.doc.features = birdbathHousing(currentOptics());
    view.setXray($('xray').checked = true);
    status('Birdbath housing, sized from the Optics design. Select a feature to edit it, or import a scan.');
  }
  refresh();
  await tick();
  view.fit();
  window.__labstudio = S; // for debugging and the browser test
}
showTab(location.hash.slice(1));
boot().catch((e) => status(`Couldn’t start the geometry kernel: ${e.message}`, true));
