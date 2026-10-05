// CAD / data exporters. All return Uint8Array (or string for text formats) and
// never touch the DOM, so they run in tests. `download()` is the browser helper.
//
// Mesh input: { pos: Float32Array xyz, idx: Uint32Array, col?: Uint8Array rgba }
// Units: whatever `pos` is in; the app converts to the unit the user picks.

const enc = new TextEncoder();

export function vertexNormals(pos, idx) {
  const nrm = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ux = pos[3 * b] - pos[3 * a], uy = pos[3 * b + 1] - pos[3 * a + 1], uz = pos[3 * b + 2] - pos[3 * a + 2];
    const vx = pos[3 * c] - pos[3 * a], vy = pos[3 * c + 1] - pos[3 * a + 1], vz = pos[3 * c + 2] - pos[3 * a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { nrm[3 * v] += nx; nrm[3 * v + 1] += ny; nrm[3 * v + 2] += nz; }
  }
  for (let i = 0; i < nrm.length; i += 3) {
    const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
    nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l;
  }
  return nrm;
}

// ---------------- STL (binary) ----------------
export function toSTL(mesh, name = 'splattunnel') {
  const { pos, idx } = mesh;
  const n = idx.length / 3;
  const out = new Uint8Array(84 + 50 * n);
  out.set(enc.encode(`binary STL from ${name}`.slice(0, 79)));
  const dv = new DataView(out.buffer);
  dv.setUint32(80, n, true);
  for (let t = 0; t < n; t++) {
    const a = idx[3 * t], b = idx[3 * t + 1], c = idx[3 * t + 2];
    const ux = pos[3 * b] - pos[3 * a], uy = pos[3 * b + 1] - pos[3 * a + 1], uz = pos[3 * b + 2] - pos[3 * a + 2];
    const vx = pos[3 * c] - pos[3 * a], vy = pos[3 * c + 1] - pos[3 * a + 1], vz = pos[3 * c + 2] - pos[3 * a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const o = 84 + 50 * t;
    dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
    let k = o + 12;
    for (const v of [a, b, c]) {
      dv.setFloat32(k, pos[3 * v], true); dv.setFloat32(k + 4, pos[3 * v + 1], true); dv.setFloat32(k + 8, pos[3 * v + 2], true);
      k += 12;
    }
  }
  return out;
}

// ---------------- OBJ (with vertex colors) ----------------
export function toOBJ(mesh, name = 'splattunnel') {
  const { pos, idx, col } = mesh;
  const L = [`# ${name}`, `o ${name.replace(/\s+/g, '_')}`];
  for (let i = 0; i < pos.length / 3; i++) {
    let s = `v ${+pos[3 * i].toFixed(6)} ${+pos[3 * i + 1].toFixed(6)} ${+pos[3 * i + 2].toFixed(6)}`;
    if (col) s += ` ${(col[4 * i] / 255).toFixed(4)} ${(col[4 * i + 1] / 255).toFixed(4)} ${(col[4 * i + 2] / 255).toFixed(4)}`;
    L.push(s);
  }
  for (let t = 0; t < idx.length; t += 3) L.push(`f ${idx[t] + 1} ${idx[t + 1] + 1} ${idx[t + 2] + 1}`);
  return enc.encode(L.join('\n') + '\n');
}

// ---------------- PLY mesh (binary, vertex colors) ----------------
export function toPLYMesh(mesh) {
  const { pos, idx, col } = mesh;
  const nv = pos.length / 3, nf = idx.length / 3;
  const head = ['ply', 'format binary_little_endian 1.0', 'comment splattunnel', `element vertex ${nv}`,
    'property float x', 'property float y', 'property float z'];
  if (col) head.push('property uchar red', 'property uchar green', 'property uchar blue');
  head.push(`element face ${nf}`, 'property list uchar int vertex_indices', 'end_header', '');
  const h = enc.encode(head.join('\n'));
  const vs = 12 + (col ? 3 : 0);
  const out = new Uint8Array(h.length + nv * vs + nf * 13);
  out.set(h);
  const dv = new DataView(out.buffer);
  let o = h.length;
  for (let i = 0; i < nv; i++) {
    dv.setFloat32(o, pos[3 * i], true); dv.setFloat32(o + 4, pos[3 * i + 1], true); dv.setFloat32(o + 8, pos[3 * i + 2], true);
    if (col) { out[o + 12] = col[4 * i]; out[o + 13] = col[4 * i + 1]; out[o + 14] = col[4 * i + 2]; }
    o += vs;
  }
  for (let t = 0; t < nf; t++) {
    out[o] = 3;
    dv.setInt32(o + 1, idx[3 * t], true); dv.setInt32(o + 5, idx[3 * t + 1], true); dv.setInt32(o + 9, idx[3 * t + 2], true);
    o += 13;
  }
  return out;
}

// ---------------- GLB (glTF 2.0 binary) ----------------
// meshes: [{ name, pos, idx, col?, color?: [r,g,b,a] }], extras: stored on the scene
export function toGLB(meshes, { extras } = {}) {
  if (!Array.isArray(meshes)) meshes = [meshes];
  const chunks = [];
  let byteLength = 0;
  const bufferViews = [], accessors = [], gltfMeshes = [], nodes = [], materials = [];
  const addView = (arr, target) => {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) { chunks.push(new Uint8Array(pad)); byteLength += pad; }
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length, target });
    chunks.push(bytes); byteLength += bytes.length;
    return bufferViews.length - 1;
  };
  meshes.forEach((m, mi) => {
    const nv = m.pos.length / 3;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) { const v = m.pos[3 * i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
    const pos = Float32Array.from(m.pos);
    const nrm = vertexNormals(pos, m.idx);
    const attributes = {};
    accessors.push({ bufferView: addView(pos, 34962), componentType: 5126, count: nv, type: 'VEC3', min, max });
    attributes.POSITION = accessors.length - 1;
    accessors.push({ bufferView: addView(nrm, 34962), componentType: 5126, count: nv, type: 'VEC3' });
    attributes.NORMAL = accessors.length - 1;
    if (m.col) {
      const c = new Uint8Array(nv * 4);
      c.set(m.col.subarray(0, nv * 4));
      accessors.push({ bufferView: addView(c, 34962), componentType: 5121, normalized: true, count: nv, type: 'VEC4' });
      attributes.COLOR_0 = accessors.length - 1;
    }
    const idx = Uint32Array.from(m.idx);
    accessors.push({ bufferView: addView(idx, 34963), componentType: 5125, count: idx.length, type: 'SCALAR' });
    const indices = accessors.length - 1;
    const color = m.color || [0.8, 0.8, 0.8, 1];
    materials.push({ name: `${m.name || 'body'}-material`, pbrMetallicRoughness: { baseColorFactor: color, metallicFactor: 0, roughnessFactor: 0.8 }, alphaMode: color[3] < 1 ? 'BLEND' : 'OPAQUE', doubleSided: true });
    gltfMeshes.push({ name: m.name || `mesh${mi}`, primitives: [{ attributes, indices, material: materials.length - 1, mode: 4 }] });
    nodes.push({ name: m.name || `mesh${mi}`, mesh: gltfMeshes.length - 1 });
  });
  const pad = (4 - (byteLength % 4)) % 4;
  if (pad) { chunks.push(new Uint8Array(pad)); byteLength += pad; }
  const json = {
    asset: { version: '2.0', generator: 'splattunnel' },
    scene: 0,
    scenes: [{ name: 'splattunnel', nodes: nodes.map((_, i) => i), ...(extras ? { extras } : {}) }],
    nodes, meshes: gltfMeshes, materials, accessors, bufferViews,
    buffers: [{ byteLength }],
  };
  let jb = enc.encode(JSON.stringify(json));
  const jpad = (4 - (jb.length % 4)) % 4;
  if (jpad) { const t = new Uint8Array(jb.length + jpad).fill(0x20); t.set(jb); jb = t; }
  const total = 12 + 8 + jb.length + 8 + byteLength;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jb.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(jb, 20);
  let o = 20 + jb.length;
  dv.setUint32(o, byteLength, true); dv.setUint32(o + 4, 0x004e4942, true); o += 8;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// ---------------- 3MF (3D printing; a zip of XML) ----------------
export function to3MF(mesh, { unit = 'millimeter', name = 'splattunnel' } = {}) {
  const { pos, idx } = mesh;
  const v = [], t = [];
  for (let i = 0; i < pos.length / 3; i++) v.push(`<vertex x="${+pos[3 * i].toFixed(5)}" y="${+pos[3 * i + 1].toFixed(5)}" z="${+pos[3 * i + 2].toFixed(5)}"/>`);
  for (let k = 0; k < idx.length; k += 3) t.push(`<triangle v1="${idx[k]}" v2="${idx[k + 1]}" v3="${idx[k + 2]}"/>`);
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="${unit}" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Title">${xmlEsc(name)}</metadata>
<metadata name="Application">splattunnel</metadata>
<resources><object id="1" type="model"><mesh><vertices>${v.join('')}</vertices><triangles>${t.join('')}</triangles></mesh></object></resources>
<build><item objectid="1"/></build>
</model>`;
  const types = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;
  return zip([
    { name: '[Content_Types].xml', data: enc.encode(types) },
    { name: '_rels/.rels', data: enc.encode(rels) },
    { name: '3D/3dmodel.model', data: enc.encode(model) },
  ]);
}

const xmlEsc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

// ---------------- cleaned Gaussian splats (standard 3DGS PLY) ----------------
// splats: loader output. keep: optional Uint8Array(n) (1 = keep). Original PLY
// properties (all SH bands) are preserved when the source was a 3DGS PLY.
export function toSplatPLY(splats, keep) {
  const n = splats.pos.length / 3;
  const ids = [];
  for (let i = 0; i < n; i++) if (!keep || keep[i]) ids.push(i);
  let props, get;
  if (splats.raw && splats.rawProps) {
    props = splats.rawProps;
    get = (p, i) => splats.raw[p][i];
  } else {
    props = ['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
    const SH_C0 = 0.28209479177387814;
    get = (p, i) => {
      switch (p) {
        case 'x': return splats.pos[3 * i]; case 'y': return splats.pos[3 * i + 1]; case 'z': return splats.pos[3 * i + 2];
        case 'nx': case 'ny': case 'nz': return 0;
        case 'f_dc_0': return (splats.col[4 * i] / 255 - 0.5) / SH_C0;
        case 'f_dc_1': return (splats.col[4 * i + 1] / 255 - 0.5) / SH_C0;
        case 'f_dc_2': return (splats.col[4 * i + 2] / 255 - 0.5) / SH_C0;
        case 'opacity': { const o = Math.min(Math.max(splats.opacity[i], 1e-6), 1 - 1e-6); return Math.log(o / (1 - o)); }
        case 'scale_0': return Math.log(Math.max(splats.scale[3 * i], 1e-9));
        case 'scale_1': return Math.log(Math.max(splats.scale[3 * i + 1], 1e-9));
        case 'scale_2': return Math.log(Math.max(splats.scale[3 * i + 2], 1e-9));
        default: return splats.rot[4 * i + Number(p.slice(4))];
      }
    };
  }
  const head = ['ply', 'format binary_little_endian 1.0', `element vertex ${ids.length}`, ...props.map((p) => `property float ${p}`), 'end_header', ''];
  const h = enc.encode(head.join('\n'));
  const out = new Uint8Array(h.length + ids.length * props.length * 4);
  out.set(h);
  const dv = new DataView(out.buffer);
  let o = h.length;
  for (const i of ids) for (const p of props) { dv.setFloat32(o, get(p, i), true); o += 4; }
  return out;
}

// ---------------- VTK flow field (legacy binary, opens in ParaView) ----------------
// field: { nx, ny, nz, spacing, origin, vel: Float32Array(3n), p: Float32Array(n), flags: Uint8Array(n) }
export function toVTK(field) {
  const { nx, ny, nz } = field;
  const n = nx * ny * nz;
  const head = enc.encode(`# vtk DataFile Version 3.0
splattunnel flow field (velocity in m/s, pressure in Pa relative to freestream)
BINARY
DATASET STRUCTURED_POINTS
DIMENSIONS ${nx} ${ny} ${nz}
ORIGIN ${field.origin.join(' ')}
SPACING ${field.spacing} ${field.spacing} ${field.spacing}
POINT_DATA ${n}
VECTORS velocity float
`);
  const sHead = enc.encode('\nSCALARS pressure float 1\nLOOKUP_TABLE default\n');
  const fHead = enc.encode('\nSCALARS solid float 1\nLOOKUP_TABLE default\n');
  const out = new Uint8Array(head.length + 12 * n + sHead.length + 4 * n + fHead.length + 4 * n + 1);
  const dv = new DataView(out.buffer);
  let o = 0;
  out.set(head, o); o += head.length;
  for (let i = 0; i < 3 * n; i++) { dv.setFloat32(o, field.vel[i], false); o += 4; } // VTK legacy = big-endian
  out.set(sHead, o); o += sHead.length;
  for (let i = 0; i < n; i++) { dv.setFloat32(o, field.p[i], false); o += 4; }
  out.set(fHead, o); o += fHead.length;
  for (let i = 0; i < n; i++) { dv.setFloat32(o, field.flags[i] === 1 ? 1 : 0, false); o += 4; }
  out[o] = 10;
  return out;
}

// ---------------- CSV (force history) ----------------
export function toCSV(rows, header) {
  const L = [header.join(',')];
  for (const r of rows) L.push(r.map((v) => (typeof v === 'number' ? +v.toPrecision(6) : v)).join(','));
  return enc.encode(L.join('\n') + '\n');
}

// ---------------- minimal zip writer (store only) ----------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; }
  return t;
})();
export function crc32(d) {
  let c = 0xffffffff;
  for (let i = 0; i < d.length; i++) c = CRC_TABLE[(c ^ d[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// files: [{ name, data: Uint8Array }]
export function zip(files) {
  const parts = [], central = [];
  let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const lh = new Uint8Array(30 + name.length);
    const l = new DataView(lh.buffer);
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x0800, true); l.setUint16(8, 0, true);
    l.setUint16(10, 0, true); l.setUint16(12, 0x21, true); l.setUint32(14, crc, true);
    l.setUint32(18, f.data.length, true); l.setUint32(22, f.data.length, true); l.setUint16(26, name.length, true);
    lh.set(name, 30);
    parts.push(lh, f.data);
    const ch = new Uint8Array(46 + name.length);
    const c = new DataView(ch.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint16(12, 0, true); c.setUint16(14, 0x21, true); c.setUint32(16, crc, true);
    c.setUint32(20, f.data.length, true); c.setUint32(24, f.data.length, true); c.setUint16(28, name.length, true);
    c.setUint32(42, off, true);
    ch.set(name, 46);
    central.push(ch);
    off += lh.length + f.data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}

// Browser download helper.
export function download(bytes, filename, type = 'application/octet-stream') {
  const blob = new Blob([bytes], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// Scale mesh positions (model units -> chosen export unit) and optionally swap to Z-up.
export function prepareForExport(mesh, { scale = 1, zUp = false } = {}) {
  const pos = new Float32Array(mesh.pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    const x = mesh.pos[i] * scale, y = mesh.pos[i + 1] * scale, z = mesh.pos[i + 2] * scale;
    if (zUp) { pos[i] = x; pos[i + 1] = -z; pos[i + 2] = y; } else { pos[i] = x; pos[i + 1] = y; pos[i + 2] = z; }
  }
  return { ...mesh, pos };
}
