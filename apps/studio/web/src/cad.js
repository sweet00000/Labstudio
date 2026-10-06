// LabStudio CAD core: a parametric feature list evaluated into solids with the
// Manifold geometry kernel (exact mesh booleans that stay watertight).
// Pure module: no DOM, so it runs in tests under Node as well as in the browser.
//
// Units are millimetres, Z is up. Each feature is a primitive or an imported mesh,
// placed by `at` (mm) and `rot` (degrees, applied about X, then Y, then Z), and
// combined into its role's running solid with `op` in list order. Two roles:
//   part       the object you print, export or put in the wind tunnel
//   reference  context you see but never export (optics, a display, a scan to trace)

export const TYPES = {
  box: { label: 'Box', params: { x: 20, y: 20, z: 20 } },
  cylinder: { label: 'Cylinder', params: { radius: 10, top: 10, height: 20 } },
  sphere: { label: 'Sphere', params: { radius: 10 } },
  mesh: { label: 'Mesh', params: { scale: 1 } },
};
export const OPS = ['add', 'subtract', 'intersect'];
export const ROLES = ['part', 'reference'];

let nextId = 1;
export const newId = (prefix = 'f') => `${prefix}${Date.now().toString(36)}${(nextId++).toString(36)}`;

export function makeFeature(type, over = {}) {
  if (!TYPES[type]) throw new Error(`Unknown feature type ${type}`);
  return {
    id: newId(), name: TYPES[type].label, type, op: 'add', role: 'part', visible: true,
    at: [0, 0, 0], rot: [0, 0, 0], ...over, params: { ...TYPES[type].params, ...(over.params || {}) },
  };
}

export function emptyDoc() {
  return { schema: 'labstudio.project', schemaVersion: 1, units: 'mm', upAxis: 'z', features: [], assets: {} };
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
// Facets per circle so the chord never sits more than 0.02 mm inside the true curve.
const CHORD_MM = 0.02;
const segmentsFor = (r) => (r <= CHORD_MM ? 8 : Math.max(32, Math.min(256, Math.ceil(Math.PI / Math.acos(1 - CHORD_MM / r)))));

// Throws a readable message if a feature can't be built.
export function checkFeature(f, assets) {
  const p = f.params;
  for (const [k, v] of Object.entries(p)) if (k !== 'asset' && !finite(v)) throw new Error(`${f.name}: ${k} must be a number.`);
  for (const v of [...f.at, ...f.rot]) if (!finite(v)) throw new Error(`${f.name}: position and rotation must be numbers.`);
  if (f.type === 'box' && !(p.x > 0 && p.y > 0 && p.z > 0)) throw new Error(`${f.name}: box sides must be positive.`);
  if (f.type === 'cylinder' && !(p.height > 0 && p.radius >= 0 && p.top >= 0 && p.radius + p.top > 0)) throw new Error(`${f.name}: cylinder needs a positive height and radius.`);
  if (f.type === 'sphere' && !(p.radius > 0)) throw new Error(`${f.name}: sphere radius must be positive.`);
  if (f.type === 'mesh' && !(p.scale > 0)) throw new Error(`${f.name}: scale must be positive.`);
  if (f.type === 'mesh' && !assets[p.asset]) throw new Error(`${f.name}: its mesh data is missing.`);
}

// Turns {pos, idx} into a Manifold. Throws if the mesh isn't a closed, consistent solid.
export function manifoldFromMesh(wasm, pos, idx) {
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: Float32Array.from(pos), triVerts: Uint32Array.from(idx) });
  mesh.merge();
  return new wasm.Manifold(mesh);
}

export function meshFromManifold(m) {
  const mesh = m.getMesh();
  const n = mesh.numProp;
  let pos = mesh.vertProperties;
  if (n !== 3) {
    pos = new Float32Array((mesh.vertProperties.length / n) * 3);
    for (let i = 0, j = 0; i < mesh.vertProperties.length; i += n, j += 3) pos.set(mesh.vertProperties.subarray(i, i + 3), j);
  }
  return { pos: Float32Array.from(pos), idx: Uint32Array.from(mesh.triVerts) };
}

// Evaluates documents. Keeps one Manifold per mesh asset so scans aren't rebuilt on every edit.
export class Evaluator {
  constructor(wasm) { this.wasm = wasm; this.assetCache = new Map(); }

  assetSolid(id, asset) {
    let m = this.assetCache.get(id);
    if (!m) { m = manifoldFromMesh(this.wasm, asset.pos, asset.idx); this.assetCache.set(id, m); }
    return m;
  }

  // The feature's own solid, placed in the world. Caller deletes it.
  solid(f, assets) {
    checkFeature(f, assets);
    const { Manifold } = this.wasm, p = f.params;
    let base;
    if (f.type === 'box') base = Manifold.cube([p.x, p.y, p.z], true);
    else if (f.type === 'cylinder') base = Manifold.cylinder(p.height, p.radius, p.top, segmentsFor(Math.max(p.radius, p.top)), true);
    else if (f.type === 'sphere') base = Manifold.sphere(p.radius, segmentsFor(p.radius));
    else base = this.assetSolid(p.asset, assets[p.asset]).scale(p.scale);
    const r = base.rotate(f.rot); base.delete();
    const out = r.translate(f.at); r.delete();
    return out;
  }

  // Returns { part, reference, errors: {featureId: message} }. Caller deletes part/reference.
  evaluate(doc) {
    const acc = { part: null, reference: null }, errors = {};
    for (const f of doc.features) {
      if (!f.visible) continue;
      let s;
      try { s = this.solid(f, doc.assets); } catch (e) { errors[f.id] = e.message; continue; }
      const cur = acc[f.role];
      if (!cur) {
        if (f.op === 'add') acc[f.role] = s; else s.delete(); // nothing to cut or intersect yet
        continue;
      }
      const next = f.op === 'add' ? cur.add(s) : f.op === 'subtract' ? cur.subtract(s) : cur.intersect(s);
      cur.delete(); s.delete();
      acc[f.role] = next;
    }
    return { ...acc, errors };
  }

  forget(id) { this.assetCache.get(id)?.delete(); this.assetCache.delete(id); }
}

export function analyze(m, densityGcm3 = 1.24) {
  if (!m || m.isEmpty()) return null;
  const bb = m.boundingBox();
  const volume = m.volume();
  return {
    volume, area: m.surfaceArea(), min: bb.min, max: bb.max,
    size: [0, 1, 2].map((k) => bb.max[k] - bb.min[k]),
    triangles: m.numTri(), genus: m.genus(), massG: (volume / 1000) * densityGcm3,
  };
}

// For printing: lift the part so it rests on the bed (z = 0) and centre it in XY.
export function placeOnBed(mesh) {
  const pos = Float32Array.from(mesh.pos);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[i + k]); max[k] = Math.max(max[k], pos[i + k]); }
  const shift = [-(min[0] + max[0]) / 2, -(min[1] + max[1]) / 2, -min[2]];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) pos[i + k] += shift[k];
  return { pos, idx: mesh.idx };
}

// ---------- project files ----------
const b64 = {
  enc(typed) {
    const u8 = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(s);
  },
  dec(str, Type) {
    const s = atob(str), u8 = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
    return new Type(u8.buffer);
  },
};

export function docToJSON(doc) {
  const used = new Set(doc.features.filter((f) => f.type === 'mesh').map((f) => f.params.asset));
  const assets = {};
  for (const id of used) {
    const a = doc.assets[id];
    if (a) assets[id] = { name: a.name, source: a.source, pos: b64.enc(a.pos), idx: b64.enc(a.idx) };
  }
  return JSON.stringify({ ...doc, assets }, null, 1);
}

export function docFromJSON(text) {
  const raw = typeof text === 'string' ? JSON.parse(text) : text;
  if (raw?.schema !== 'labstudio.project') throw new Error('This isn’t a LabStudio project file.');
  if (raw.schemaVersion !== 1) throw new Error(`Project version ${raw.schemaVersion} isn’t supported by this version of LabStudio.`);
  const doc = emptyDoc();
  for (const [id, a] of Object.entries(raw.assets || {})) {
    doc.assets[id] = { name: a.name, source: a.source, pos: typeof a.pos === 'string' ? b64.dec(a.pos, Float32Array) : Float32Array.from(a.pos), idx: typeof a.idx === 'string' ? b64.dec(a.idx, Uint32Array) : Uint32Array.from(a.idx) };
  }
  for (const f of raw.features || []) {
    if (!TYPES[f.type] || !OPS.includes(f.op) || !ROLES.includes(f.role)) throw new Error(`Feature “${f.name}” isn’t valid.`);
    doc.features.push({ ...makeFeature(f.type), ...f, params: { ...TYPES[f.type].params, ...f.params } });
  }
  return doc;
}
