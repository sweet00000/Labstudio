// Voxel solid -> watertight triangle mesh (naive surface nets + Taubin smoothing).
// Used to turn a Gaussian-splat scan (which has no surface) into CAD geometry.
// Pure JS, no DOM.

// Box-blur a 0/1 mask into a smooth scalar field in [0,1] (radius 1, separable).
function blur(mask, nx, ny, nz) {
  let a = Float32Array.from(mask);
  let b = new Float32Array(a.length);
  const nxy = nx * ny;
  const strides = [[1, nx], [nx, ny], [nxy, nz]];
  for (const [s, len] of strides) {
    for (let i = 0; i < a.length; i++) {
      const coord = s === 1 ? i % nx : s === nx ? ((i / nx) | 0) % ny : (i / nxy) | 0;
      let sum = a[i] * 2, w = 2;
      if (coord > 0) { sum += a[i - s]; w++; }
      if (coord < len - 1) { sum += a[i + s]; w++; }
      b[i] = sum / w;
    }
    [a, b] = [b, a];
  }
  return a;
}

// solid: Uint8Array(nx*ny*nz). Returns { pos (lattice units), idx }.
export function surfaceNets(solid, nx, ny, nz, { smooth = true, iso = 0.5 } = {}) {
  // pad by one cell so the surface is always closed
  const px = nx + 2, py = ny + 2, pz = nz + 2;
  const pm = new Uint8Array(px * py * pz);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    pm[(x + 1) + px * ((y + 1) + py * (z + 1))] = solid[x + nx * (y + ny * z)];
  }
  const f = smooth ? blur(pm, px, py, pz) : Float32Array.from(pm);
  const pxy = px * py;
  const at = (x, y, z) => f[x + px * y + pxy * z];
  // one vertex per cell (cell = cube between samples x..x+1) that the surface crosses
  const vid = new Int32Array((px - 1) * (py - 1) * (pz - 1)).fill(-1);
  const cidx = (x, y, z) => x + (px - 1) * (y + (py - 1) * z);
  const P = [];
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const v = new Float32Array(8);
  for (let z = 0; z < pz - 1; z++) for (let y = 0; y < py - 1; y++) for (let x = 0; x < px - 1; x++) {
    let inside = 0;
    for (let k = 0; k < 8; k++) { v[k] = at(x + corners[k][0], y + corners[k][1], z + corners[k][2]); if (v[k] > iso) inside++; }
    if (inside === 0 || inside === 8) continue;
    let sx = 0, sy = 0, sz = 0, cnt = 0;
    for (const [a, b] of edges) {
      if ((v[a] > iso) === (v[b] > iso)) continue;
      const t = (iso - v[a]) / (v[b] - v[a]);
      sx += corners[a][0] + t * (corners[b][0] - corners[a][0]);
      sy += corners[a][1] + t * (corners[b][1] - corners[a][1]);
      sz += corners[a][2] + t * (corners[b][2] - corners[a][2]);
      cnt++;
    }
    vid[cidx(x, y, z)] = P.length / 3;
    // -1 undoes the padding offset so vertices land in the original lattice frame
    P.push(x + sx / cnt - 1, y + sy / cnt - 1, z + sz / cnt - 1);
  }
  // one quad per sample-grid edge with a sign change, joining the 4 cells around it
  const I = [];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) I.push(a, c, b, a, d, c); else I.push(a, b, c, a, c, d);
  };
  // padding samples are always below iso, so edges on the outer shell never cross
  for (let z = 0; z < pz - 1; z++) for (let y = 0; y < py - 1; y++) for (let x = 0; x < px - 1; x++) {
    const s0 = at(x, y, z) > iso;
    if (y > 0 && z > 0 && s0 !== (at(x + 1, y, z) > iso)) {
      quad(vid[cidx(x, y - 1, z - 1)], vid[cidx(x, y, z - 1)], vid[cidx(x, y, z)], vid[cidx(x, y - 1, z)], !s0);
    }
    if (x > 0 && z > 0 && s0 !== (at(x, y + 1, z) > iso)) {
      quad(vid[cidx(x - 1, y, z - 1)], vid[cidx(x - 1, y, z)], vid[cidx(x, y, z)], vid[cidx(x, y, z - 1)], !s0);
    }
    if (x > 0 && y > 0 && s0 !== (at(x, y, z + 1) > iso)) {
      quad(vid[cidx(x - 1, y - 1, z)], vid[cidx(x, y - 1, z)], vid[cidx(x, y, z)], vid[cidx(x - 1, y, z)], !s0);
    }
  }
  let pos = Float32Array.from(P);
  const idx = Uint32Array.from(I);
  if (smooth) pos = taubin(pos, idx, 6);
  return { pos, idx };
}

// Taubin (lambda/mu) smoothing: removes voxel stair-steps without shrinking.
export function taubin(pos, idx, iters = 6, lambda = 0.5, mu = -0.53) {
  const n = pos.length / 3;
  const nbr = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    nbr[a].add(b); nbr[a].add(c); nbr[b].add(a); nbr[b].add(c); nbr[c].add(a); nbr[c].add(b);
  }
  const lists = nbr.map((s) => Int32Array.from(s));
  let p = pos.slice();
  const tmp = new Float32Array(p.length);
  const pass = (k) => {
    for (let i = 0; i < n; i++) {
      const L = lists[i];
      if (!L.length) { tmp[3 * i] = p[3 * i]; tmp[3 * i + 1] = p[3 * i + 1]; tmp[3 * i + 2] = p[3 * i + 2]; continue; }
      let ax = 0, ay = 0, az = 0;
      for (const j of L) { ax += p[3 * j]; ay += p[3 * j + 1]; az += p[3 * j + 2]; }
      ax = ax / L.length - p[3 * i]; ay = ay / L.length - p[3 * i + 1]; az = az / L.length - p[3 * i + 2];
      tmp[3 * i] = p[3 * i] + k * ax; tmp[3 * i + 1] = p[3 * i + 1] + k * ay; tmp[3 * i + 2] = p[3 * i + 2] + k * az;
    }
    p.set(tmp);
  };
  for (let it = 0; it < iters; it++) { pass(lambda); pass(mu); }
  return p;
}

// Mesh statistics used by the export panel and tests.
export function meshStats(pos, idx) {
  const edges = new Map();
  let vol = 0, area = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    for (const [u, w] of [[a, b], [b, c], [c, a]]) {
      const key = u < w ? `${u}_${w}` : `${w}_${u}`;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
    const ax = pos[3 * a], ay = pos[3 * a + 1], az = pos[3 * a + 2];
    const bx = pos[3 * b], by = pos[3 * b + 1], bz = pos[3 * b + 2];
    const cx = pos[3 * c], cy = pos[3 * c + 1], cz = pos[3 * c + 2];
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    area += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  let open = 0, nonManifold = 0;
  for (const c of edges.values()) { if (c === 1) open++; else if (c > 2) nonManifold++; }
  return { vertices: pos.length / 3, triangles: idx.length / 3, volume: vol, area, openEdges: open, nonManifoldEdges: nonManifold, watertight: open === 0 && nonManifold === 0 };
}
