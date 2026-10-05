// Fit solids into the wind tunnel and turn a voxel mask into LBM cell flags.
// The general voxel tools live in packages/geometry/voxel.js and are re-exported here.
import { FLAG, C } from './lbm.js';
export * from '../../../../packages/geometry/voxel.js';

// Size the tunnel around the body. `bodyCells` = cells along the body's
// longest side. The cross-section targets ~3% blockage and the wake gets
// ~5 body heights, which keeps wall effects small.
export function tunnelGrid(b, bodyCells, ground) {
  const L = Math.max(b.size[0], b.size[1], b.size[2]) || 1;
  const s = bodyCells / L;
  const lx = b.size[0] * s, hy = b.size[1] * s, wz = b.size[2] * s;
  const d = Math.max(hy, wz, 2);
  // margins stay clear of the solver's 10-cell sponge layer at the tunnel edges
  const up = Math.max(0.8 * lx, 2 * d, 16);
  const down = Math.max(2 * lx, 5 * d, 24);
  const even = (v) => 2 * Math.ceil(v / 2);
  const nx = even(up + lx + down);
  const ny = even(ground ? Math.max(hy * 4.5, wz * 2, hy + 14) : Math.max(hy * 5, wz * 3, hy + 28));
  const nz = even(Math.max(wz * 5, hy * 3, wz + 28));
  return { nx, ny, nz, bodyCells, x0: Math.round(up) };
}

// Map model coordinates into lattice coordinates. The body's longest
// dimension gets `bodyCells` cells; it sits on the floor (y=1) when ground is
// on, is centered in z, and starts at x0 (default 25% of the tunnel length).
export function fitTransform(b, nx, ny, nz, { bodyCells, ground = true, x0 }) {
  const L = Math.max(b.size[0], b.size[1], b.size[2]) || 1;
  const s = bodyCells / L;
  const start = x0 ?? Math.round(nx * 0.25);
  const off = [
    start - b.min[0] * s,
    // y = 1.0 rounds into the first fluid row, so the body sits flush on the floor (no slot under it)
    ground ? 1.0 - b.min[1] * s : ny / 2 - (b.min[1] + b.size[1] / 2) * s,
    nz / 2 - (b.min[2] + b.size[2] / 2) * s,
  ];
  return { scale: s, offset: off, cellSize: 1 / s };
}

export function applyTransform(pos, t) {
  const out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    out[i] = pos[i] * t.scale + t.offset[0];
    out[i + 1] = pos[i + 1] * t.scale + t.offset[1];
    out[i + 2] = pos[i + 2] * t.scale + t.offset[2];
  }
  return out;
}

// body: Uint8Array(n) with 1 = solid body. Returns flags + stats for the solver.
export function buildTunnel(body, nx, ny, nz, { ground = true } = {}) {
  const n = nx * ny * nz, nxy = nx * ny;
  const flags = new Uint8Array(n);
  let bodyCount = 0;
  const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = x + nx * y + nxy * z;
    const edge = x === 0 || z === 0 || x === nx - 1 || y === ny - 1 || z === nz - 1 || y === 0;
    let f = FLAG.FLUID;
    if (edge) f = FLAG.FARFIELD;
    if (x === nx - 1) f = FLAG.OUTLET;
    if (ground && y === 0) f = FLAG.WALL;
    if (!edge && body[i]) {
      f = FLAG.BODY; bodyCount++;
      if (x < bb[0]) bb[0] = x;
      if (y < bb[1]) bb[1] = y;
      if (z < bb[2]) bb[2] = z;
      if (x > bb[3]) bb[3] = x;
      if (y > bb[4]) bb[4] = y;
      if (z > bb[5]) bb[5] = z;
    }
    flags[i] = f;
  }
  // fluid cells that exchange momentum with the body
  const offs = C.slice(1).map(([x, y, z]) => x + nx * y + nxy * z);
  const cells = [];
  for (let i = 0; i < n; i++) {
    if (flags[i] !== FLAG.FLUID) continue;
    for (const o of offs) { if (flags[i - o] === FLAG.BODY) { cells.push(i); break; } }
  }
  // frontal (x-projected) and planform (y-projected) areas
  const proj = new Uint8Array(ny * nz);
  const top = new Uint8Array(nx * nz);
  for (let z = 1; z < nz - 1; z++) for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) {
    if (flags[x + nx * y + nxy * z] !== FLAG.BODY) continue;
    proj[y + ny * z] = 1;
    top[x + nx * z] = 1;
  }
  let frontalArea = 0, planformArea = 0;
  for (let i = 0; i < proj.length; i++) frontalArea += proj[i];
  for (let i = 0; i < top.length; i++) planformArea += top[i];
  const section = (ny - 2) * (nz - 2);
  return {
    flags,
    boundaryCells: Uint32Array.from(cells),
    bodyCount,
    frontalArea,
    planformArea,
    blockage: frontalArea / section,
    bbox: bodyCount ? bb : null,
  };
}
