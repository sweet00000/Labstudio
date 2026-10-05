// Loaders for scan formats. Everything returns one of:
//   { kind: 'mesh', pos: Float32Array, idx: Uint32Array, col: Uint8Array|null }
//   { kind: 'splats', pos, scale (linear, 3/elt), rot (w,x,y,z), opacity (0..1), col (rgba8), raw? }
// Colors are RGBA8. Units are whatever the file used.

const SH_C0 = 0.28209479177387814;
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const clamp255 = (x) => (x < 0 ? 0 : x > 255 ? 255 : x | 0);

export async function loadFile(file) {
  const buf = await file.arrayBuffer();
  return parseBuffer(buf, file.name.toLowerCase());
}

export function parseBuffer(buf, name) {
  name = name.toLowerCase();
  if (name.endsWith('.ply')) return parsePLY(buf);
  if (name.endsWith('.stl')) return parseSTL(buf);
  if (name.endsWith('.obj')) return parseOBJ(new TextDecoder().decode(buf));
  if (name.endsWith('.glb')) return parseGLB(buf);
  if (name.endsWith('.splat')) return parseSplat(buf);
  if (/\.(spz|ksplat|sog|gltf)$/.test(name)) {
    throw new Error('This format isn’t supported yet. Convert it to .ply first (SuperSplat can do it), or export .glb instead of .gltf.');
  }
  throw new Error('Unknown file type. Open a .ply, .splat, .stl, .obj or .glb file.');
}

// ---------------- PLY ----------------
const PLY_TYPES = {
  char: ['getInt8', 1], int8: ['getInt8', 1], uchar: ['getUint8', 1], uint8: ['getUint8', 1],
  short: ['getInt16', 2], int16: ['getInt16', 2], ushort: ['getUint16', 2], uint16: ['getUint16', 2],
  int: ['getInt32', 4], int32: ['getInt32', 4], uint: ['getUint32', 4], uint32: ['getUint32', 4],
  float: ['getFloat32', 4], float32: ['getFloat32', 4], double: ['getFloat64', 8], float64: ['getFloat64', 8],
};

export function parsePLY(buf) {
  const bytes = new Uint8Array(buf);
  const headText = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
  const endIdx = headText.indexOf('end_header');
  if (!headText.startsWith('ply') || endIdx < 0) throw new Error('Not a valid PLY file (header missing).');
  // body starts after the newline that ends "end_header"
  let bodyStart = new TextEncoder().encode(headText.slice(0, endIdx + 'end_header'.length)).length;
  if (bytes[bodyStart] === 13) bodyStart++;
  if (bytes[bodyStart] === 10) bodyStart++;
  let format = 'ascii';
  const elements = [];
  for (const ln of headText.slice(0, endIdx).split(/\r?\n/)) {
    const t = ln.trim().split(/\s+/);
    if (t[0] === 'format') format = t[1];
    else if (t[0] === 'element') elements.push({ name: t[1], count: parseInt(t[2], 10), props: [] });
    else if (t[0] === 'property') {
      const el = elements[elements.length - 1];
      if (t[1] === 'list') el.props.push({ name: t[4], list: true, countType: t[2], type: t[3] });
      else el.props.push({ name: t[2], type: t[1] });
    }
  }
  const data = {};
  if (format === 'ascii') {
    const tok = new TextDecoder().decode(bytes.subarray(bodyStart)).split(/\s+/).filter(Boolean);
    let p = 0;
    for (const el of elements) {
      const cols = {};
      for (const pr of el.props) cols[pr.name] = pr.list ? [] : new Float64Array(el.count);
      for (let i = 0; i < el.count; i++) {
        for (const pr of el.props) {
          if (pr.list) { const n = +tok[p++]; const a = new Array(n); for (let k = 0; k < n; k++) a[k] = +tok[p++]; cols[pr.name].push(a); }
          else cols[pr.name][i] = +tok[p++];
        }
      }
      data[el.name] = cols;
    }
  } else {
    const little = format === 'binary_little_endian';
    const dv = new DataView(buf);
    let off = bodyStart;
    for (const el of elements) {
      const cols = {};
      if (el.props.every((pr) => !pr.list)) {
        const stride = el.props.reduce((s, pr) => s + PLY_TYPES[pr.type][1], 0);
        const offsets = []; let o = 0;
        for (const pr of el.props) { offsets.push(o); o += PLY_TYPES[pr.type][1]; cols[pr.name] = new Float32Array(el.count); }
        for (let i = 0; i < el.count; i++) {
          const base = off + i * stride;
          for (let k = 0; k < el.props.length; k++) {
            const pr = el.props[k];
            cols[pr.name][i] = dv[PLY_TYPES[pr.type][0]](base + offsets[k], little);
          }
        }
        off += stride * el.count;
      } else {
        for (const pr of el.props) cols[pr.name] = pr.list ? [] : new Float64Array(el.count);
        for (let i = 0; i < el.count; i++) {
          for (const pr of el.props) {
            if (pr.list) {
              const [cf, cs] = PLY_TYPES[pr.countType]; const n = dv[cf](off, little); off += cs;
              const [vf, vs] = PLY_TYPES[pr.type]; const a = new Array(n);
              for (let k = 0; k < n; k++) { a[k] = dv[vf](off, little); off += vs; }
              cols[pr.name].push(a);
            } else {
              const [f, s] = PLY_TYPES[pr.type]; cols[pr.name][i] = dv[f](off, little); off += s;
            }
          }
        }
      }
      data[el.name] = cols;
    }
  }
  const v = data.vertex;
  if (!v || !v.x) throw new Error('PLY has no vertex positions.');
  const n = v.x.length;
  const pos = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) { pos[3 * i] = v.x[i]; pos[3 * i + 1] = v.y[i]; pos[3 * i + 2] = v.z[i]; }
  const face = data.face;
  const faceList = face && (face.vertex_indices || face.vertex_index);
  if (faceList && faceList.length) {
    const idx = [];
    for (const f of faceList) for (let k = 1; k + 1 < f.length; k++) idx.push(f[0], f[k], f[k + 1]);
    return { kind: 'mesh', pos, idx: Uint32Array.from(idx), col: plyColors(v, n) };
  }
  if (v.scale_0 && v.rot_0 && v.opacity) {
    const scale = new Float32Array(3 * n), rot = new Float32Array(4 * n), opacity = new Float32Array(n), col = new Uint8Array(4 * n);
    const hasDC = !!v.f_dc_0;
    for (let i = 0; i < n; i++) {
      scale[3 * i] = Math.exp(v.scale_0[i]); scale[3 * i + 1] = Math.exp(v.scale_1[i]); scale[3 * i + 2] = Math.exp(v.scale_2[i]);
      const w = v.rot_0[i], x = v.rot_1[i], y = v.rot_2[i], z = v.rot_3[i];
      const l = Math.hypot(w, x, y, z) || 1;
      rot[4 * i] = w / l; rot[4 * i + 1] = x / l; rot[4 * i + 2] = y / l; rot[4 * i + 3] = z / l;
      opacity[i] = sigmoid(v.opacity[i]);
      if (hasDC) {
        col[4 * i] = clamp255((0.5 + SH_C0 * v.f_dc_0[i]) * 255);
        col[4 * i + 1] = clamp255((0.5 + SH_C0 * v.f_dc_1[i]) * 255);
        col[4 * i + 2] = clamp255((0.5 + SH_C0 * v.f_dc_2[i]) * 255);
      } else if (v.red) { col[4 * i] = v.red[i]; col[4 * i + 1] = v.green[i]; col[4 * i + 2] = v.blue[i]; }
      else { col[4 * i] = col[4 * i + 1] = col[4 * i + 2] = 200; }
      col[4 * i + 3] = 255;
    }
    // keep every original property so a cleaned splat can be re-saved losslessly
    return { kind: 'splats', pos, scale, rot, opacity, col, raw: v, rawProps: elements.find((e) => e.name === 'vertex').props.map((p) => p.name) };
  }
  return pointsAsSplats(pos, plyColors(v, n));
}

function plyColors(v, n) {
  const r = v.red || v.r || v.diffuse_red, g = v.green || v.g || v.diffuse_green, b = v.blue || v.b || v.diffuse_blue;
  if (!r || !g || !b) return null;
  let maxv = 0;
  for (let i = 0; i < Math.min(n, 1000); i++) maxv = Math.max(maxv, r[i], g[i], b[i]);
  const s = maxv <= 1.0 ? 255 : 1;
  const col = new Uint8Array(4 * n);
  for (let i = 0; i < n; i++) { col[4 * i] = clamp255(r[i] * s); col[4 * i + 1] = clamp255(g[i] * s); col[4 * i + 2] = clamp255(b[i] * s); col[4 * i + 3] = 255; }
  return col;
}

// Plain point clouds become small isotropic splats sized by average spacing.
export function pointsAsSplats(pos, col) {
  const n = pos.length / 3;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[3 * i + k]); max[k] = Math.max(max[k], pos[3 * i + k]); }
  const diag = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  const r = diag / Math.cbrt(Math.max(n, 1)) * 0.6;
  const scale = new Float32Array(3 * n).fill(r), rot = new Float32Array(4 * n), opacity = new Float32Array(n).fill(0.9);
  for (let i = 0; i < n; i++) rot[4 * i] = 1;
  if (!col) { col = new Uint8Array(4 * n); col.fill(210); }
  return { kind: 'splats', pos, scale, rot, opacity, col, points: true };
}

// ---------------- .splat (antimatter15 32-byte records) ----------------
export function parseSplat(buf) {
  const n = Math.floor(buf.byteLength / 32);
  const dv = new DataView(buf);
  const u = new Uint8Array(buf);
  const pos = new Float32Array(3 * n), scale = new Float32Array(3 * n), rot = new Float32Array(4 * n), opacity = new Float32Array(n), col = new Uint8Array(4 * n);
  for (let i = 0; i < n; i++) {
    const o = 32 * i;
    for (let k = 0; k < 3; k++) { pos[3 * i + k] = dv.getFloat32(o + 4 * k, true); scale[3 * i + k] = dv.getFloat32(o + 12 + 4 * k, true); }
    col[4 * i] = u[o + 24]; col[4 * i + 1] = u[o + 25]; col[4 * i + 2] = u[o + 26]; col[4 * i + 3] = 255;
    opacity[i] = u[o + 27] / 255;
    const w = (u[o + 28] - 128) / 128, x = (u[o + 29] - 128) / 128, y = (u[o + 30] - 128) / 128, z = (u[o + 31] - 128) / 128;
    const l = Math.hypot(w, x, y, z) || 1;
    rot[4 * i] = w / l; rot[4 * i + 1] = x / l; rot[4 * i + 2] = y / l; rot[4 * i + 3] = z / l;
  }
  return { kind: 'splats', pos, scale, rot, opacity, col };
}

// ---------------- STL ----------------
export function parseSTL(buf) {
  const dv = new DataView(buf);
  const isBinary = buf.byteLength >= 84 && 84 + 50 * dv.getUint32(80, true) === buf.byteLength;
  if (isBinary) {
    const n = dv.getUint32(80, true);
    const pos = new Float32Array(9 * n);
    for (let t = 0; t < n; t++) {
      const base = 84 + 50 * t + 12;
      for (let k = 0; k < 9; k++) pos[9 * t + k] = dv.getFloat32(base + 4 * k, true);
    }
    return weld(pos);
  }
  const text = new TextDecoder().decode(buf);
  const vals = [];
  const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
  let m;
  while ((m = re.exec(text))) vals.push(+m[1], +m[2], +m[3]);
  if (!vals.length) throw new Error('STL file has no triangles.');
  return weld(Float32Array.from(vals));
}

// Merge duplicate vertices of a triangle soup.
export function weld(pos) {
  const n = pos.length / 3;
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < pos.length; i++) { if (pos[i] < min) min = pos[i]; if (pos[i] > max) max = pos[i]; }
  const q = (max - min) * 1e-6 || 1e-9;
  const map = new Map();
  const out = []; const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(pos[3 * i] / q)},${Math.round(pos[3 * i + 1] / q)},${Math.round(pos[3 * i + 2] / q)}`;
    let j = map.get(key);
    if (j === undefined) { j = out.length / 3; map.set(key, j); out.push(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]); }
    idx[i] = j;
  }
  return { kind: 'mesh', pos: Float32Array.from(out), idx, col: null };
}

// ---------------- OBJ ----------------
export function parseOBJ(text) {
  const P = [], Cc = [], idx = [];
  let hasColor = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('v ')) {
      const t = line.trim().split(/\s+/);
      P.push(+t[1], +t[2], +t[3]);
      if (t.length >= 7) { hasColor = true; Cc.push(+t[4], +t[5], +t[6]); } else Cc.push(0.8, 0.8, 0.8);
    } else if (line.startsWith('f ')) {
      const t = line.trim().split(/\s+/).slice(1).map((s) => {
        const i = parseInt(s.split('/')[0], 10);
        return i < 0 ? P.length / 3 + i : i - 1;
      });
      for (let k = 1; k + 1 < t.length; k++) idx.push(t[0], t[k], t[k + 1]);
    }
  }
  if (!idx.length) throw new Error('OBJ file has no faces.');
  let col = null;
  if (hasColor) {
    const s = Cc.some((c) => c > 1) ? 1 : 255;
    col = new Uint8Array((P.length / 3) * 4);
    for (let i = 0; i < P.length / 3; i++) { col[4 * i] = clamp255(Cc[3 * i] * s); col[4 * i + 1] = clamp255(Cc[3 * i + 1] * s); col[4 * i + 2] = clamp255(Cc[3 * i + 2] * s); col[4 * i + 3] = 255; }
  }
  return { kind: 'mesh', pos: Float32Array.from(P), idx: Uint32Array.from(idx), col };
}

// ---------------- GLB (glTF 2.0 binary), triangle meshes only ----------------
const COMP = { 5120: ['getInt8', 1], 5121: ['getUint8', 1], 5122: ['getInt16', 2], 5123: ['getUint16', 2], 5125: ['getUint32', 4], 5126: ['getFloat32', 4] };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export function parseGLB(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('Not a GLB file.');
  let off = 12, json = null, bin = null;
  while (off + 8 <= buf.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off + 8, len)));
    else if (type === 0x004e4942) bin = new Uint8Array(buf, off + 8, len);
    off += 8 + len;
  }
  if (!json) throw new Error('GLB has no JSON chunk.');
  if ((json.extensionsRequired || []).some((e) => /draco|meshopt/i.test(e))) throw new Error('Compressed GLB (Draco/meshopt) isn’t supported. Re-export without mesh compression.');
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const readAcc = (i) => {
    const a = json.accessors[i];
    const [getter, size] = COMP[a.componentType];
    const nc = NCOMP[a.type];
    const bv = json.bufferViews[a.bufferView];
    const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const stride = bv.byteStride || size * nc;
    const out = new Float64Array(a.count * nc);
    for (let e = 0; e < a.count; e++) for (let c = 0; c < nc; c++) {
      let v = view[getter](base + e * stride + c * size, true);
      if (a.normalized) v = a.componentType === 5121 ? v / 255 : a.componentType === 5123 ? v / 65535 : v;
      out[e * nc + c] = v;
    }
    return { data: out, nc };
  };
  const P = [], Cl = [], I = [];
  const mul = (a, b) => { const o = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
  const trs = (n) => {
    if (n.matrix) return n.matrix;
    const [tx, ty, tz] = n.translation || [0, 0, 0];
    const [x, y, z, w] = n.rotation || [0, 0, 0, 1];
    const [sx, sy, sz] = n.scale || [1, 1, 1];
    return [
      (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
      2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
      2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
      tx, ty, tz, 1];
  };
  const visit = (ni, parent) => {
    const node = json.nodes[ni];
    const M = mul(parent, trs(node));
    if (node.mesh !== undefined) {
      for (const prim of json.meshes[node.mesh].primitives) {
        if ((prim.mode ?? 4) !== 4 || prim.attributes.POSITION === undefined) continue;
        const pa = readAcc(prim.attributes.POSITION);
        const ca = prim.attributes.COLOR_0 !== undefined ? readAcc(prim.attributes.COLOR_0) : null;
        const mat = prim.material !== undefined ? json.materials?.[prim.material] : null;
        const bc = mat?.pbrMetallicRoughness?.baseColorFactor || [0.8, 0.8, 0.8, 1];
        const base = P.length / 3;
        const cnt = pa.data.length / 3;
        for (let e = 0; e < cnt; e++) {
          const x = pa.data[3 * e], y = pa.data[3 * e + 1], z = pa.data[3 * e + 2];
          P.push(M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]);
          if (ca) Cl.push(ca.data[ca.nc * e], ca.data[ca.nc * e + 1], ca.data[ca.nc * e + 2]);
          else Cl.push(bc[0], bc[1], bc[2]);
        }
        if (prim.indices !== undefined) { const ia = readAcc(prim.indices); for (const v of ia.data) I.push(base + v); }
        else for (let e = 0; e < cnt; e++) I.push(base + e);
      }
    }
    for (const c of node.children || []) visit(c, M);
  };
  const scene = json.scenes?.[json.scene ?? 0];
  const roots = scene ? scene.nodes : json.nodes.map((_, i) => i);
  const ident = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const r of roots) visit(r, ident);
  if (!I.length) throw new Error('GLB has no triangle meshes.');
  const col = new Uint8Array((P.length / 3) * 4);
  for (let i = 0; i < P.length / 3; i++) { col[4 * i] = clamp255(Cl[3 * i] * 255); col[4 * i + 1] = clamp255(Cl[3 * i + 1] * 255); col[4 * i + 2] = clamp255(Cl[3 * i + 2] * 255); col[4 * i + 3] = 255; }
  return { kind: 'mesh', pos: Float32Array.from(P), idx: Uint32Array.from(I), col };
}
