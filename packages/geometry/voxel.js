// Voxel tools for scans and meshes: bounds, rasterizing, hole closing, floater removal.
// Pure JS, no DOM. Shared by the CAD workspace and the wind tunnel.

// Axis-aligned bounds of an xyz Float32Array.
export function bounds(pos) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) { const v = pos[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

// Mark voxels touched by triangles. pos: Float32Array xyz already in lattice units.
export function rasterizeMesh(pos, idx, nx, ny, nz) {
  const mask = new Uint8Array(nx * ny * nz);
  const nxy = nx * ny;
  const mark = (x, y, z) => {
    const ix = Math.round(x), iy = Math.round(y), iz = Math.round(z);
    if (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz) return;
    mask[ix + nx * iy + nxy * iz] = 1;
  };
  const triCount = idx ? idx.length / 3 : pos.length / 9;
  for (let t = 0; t < triCount; t++) {
    const a = idx ? idx[3 * t] : 3 * t, b = idx ? idx[3 * t + 1] : 3 * t + 1, c = idx ? idx[3 * t + 2] : 3 * t + 2;
    const ax = pos[3 * a], ay = pos[3 * a + 1], az = pos[3 * a + 2];
    const bx = pos[3 * b], by = pos[3 * b + 1], bz = pos[3 * b + 2];
    const cx = pos[3 * c], cy = pos[3 * c + 1], cz = pos[3 * c + 2];
    const e1 = Math.hypot(bx - ax, by - ay, bz - az);
    const e2 = Math.hypot(cx - ax, cy - ay, cz - az);
    const e3 = Math.hypot(cx - bx, cy - by, cz - bz);
    const s = Math.max(1, Math.ceil(Math.max(e1, e2, e3) / 0.45));
    if (s === 1) { mark(ax, ay, az); mark(bx, by, bz); mark(cx, cy, cz); mark((ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3); continue; }
    for (let i = 0; i <= s; i++) {
      for (let j = 0; j <= s - i; j++) {
        const u = i / s, v = j / s, w = 1 - u - v;
        mark(w * ax + u * bx + v * cx, w * ay + u * by + v * cy, w * az + u * bz + v * cz);
      }
    }
  }
  return mask;
}

// Mark voxels covered by opaque Gaussians. centers: Float32Array xyz (lattice),
// radii: Float32Array (lattice units, ~1-sigma extent), opac: Float32Array 0..1
export function rasterizeSplats(centers, radii, opac, nx, ny, nz, { minOpacity = 0.35, maxRadius = 2.0 } = {}) {
  const mask = new Uint8Array(nx * ny * nz);
  const nxy = nx * ny;
  const n = centers.length / 3;
  for (let i = 0; i < n; i++) {
    if (opac[i] < minOpacity) continue;
    const x = centers[3 * i], y = centers[3 * i + 1], z = centers[3 * i + 2];
    const r = Math.min(radii[i], maxRadius);
    if (r < 0.6) {
      const ix = Math.round(x), iy = Math.round(y), iz = Math.round(z);
      if (ix >= 0 && iy >= 0 && iz >= 0 && ix < nx && iy < ny && iz < nz) mask[ix + nx * iy + nxy * iz] = 1;
      continue;
    }
    const r2 = r * r;
    const x0 = Math.max(0, Math.ceil(x - r)), x1 = Math.min(nx - 1, Math.floor(x + r));
    const y0 = Math.max(0, Math.ceil(y - r)), y1 = Math.min(ny - 1, Math.floor(y + r));
    const z0 = Math.max(0, Math.ceil(z - r)), z1 = Math.min(nz - 1, Math.floor(z + r));
    for (let iz = z0; iz <= z1; iz++) for (let iy = y0; iy <= y1; iy++) for (let ix = x0; ix <= x1; ix++) {
      const dx = ix - x, dy = iy - y, dz = iz - z;
      if (dx * dx + dy * dy + dz * dz <= r2) mask[ix + nx * iy + nxy * iz] = 1;
    }
  }
  return mask;
}

function dilate6(mask, nx, ny, nz) {
  const out = mask.slice();
  const nxy = nx * ny;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) {
    let i = nx * y + nxy * z;
    for (let x = 0; x < nx; x++, i++) {
      if (!mask[i]) continue;
      if (x > 0) out[i - 1] = 1;
      if (x < nx - 1) out[i + 1] = 1;
      if (y > 0) out[i - nx] = 1;
      if (y < ny - 1) out[i + nx] = 1;
      if (z > 0) out[i - nxy] = 1;
      if (z < nz - 1) out[i + nxy] = 1;
    }
  }
  return out;
}

function erode6(mask, nx, ny, nz) {
  const out = mask.slice();
  const nxy = nx * ny;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) {
    let i = nx * y + nxy * z;
    for (let x = 0; x < nx; x++, i++) {
      if (!mask[i]) continue;
      if ((x > 0 && !mask[i - 1]) || (x < nx - 1 && !mask[i + 1]) || (y > 0 && !mask[i - nx]) ||
          (y < ny - 1 && !mask[i + nx]) || (z > 0 && !mask[i - nxy]) || (z < nz - 1 && !mask[i + nxy])) out[i] = 0;
    }
  }
  return out;
}

// Everything reachable from the domain boundary without crossing the surface is outside.
function outside(mask, nx, ny, nz) {
  const n = nx * ny * nz, nxy = nx * ny;
  const ext = new Uint8Array(n);
  const q = new Int32Array(n);
  let head = 0, tail = 0;
  const push = (i) => { if (!mask[i] && !ext[i]) { ext[i] = 1; q[tail++] = i; } };
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    if (x === 0 || y === 0 || z === 0 || x === nx - 1 || y === ny - 1 || z === nz - 1) push(x + nx * y + nxy * z);
  }
  while (head < tail) {
    const i = q[head++];
    const x = i % nx, y = ((i / nx) | 0) % ny, z = (i / nxy) | 0;
    if (x > 0) push(i - 1);
    if (x < nx - 1) push(i + 1);
    if (y > 0) push(i - nx);
    if (y < ny - 1) push(i + nx);
    if (z > 0) push(i - nxy);
    if (z < nz - 1) push(i + nxy);
  }
  return ext;
}

// Fill interiors; `close` > 0 bridges surface gaps up to ~2*close voxels wide.
// `shrink` erodes the result to undo the outward thickening that splat radii
// add to a scanned shell (use ~ the mean splat radius in voxels, rounded).
export function solidify(surface, nx, ny, nz, close = 1, shrink = 0) {
  let m = surface;
  for (let k = 0; k < close; k++) m = dilate6(m, nx, ny, nz);
  const ext = outside(m, nx, ny, nz);
  let solid = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) solid[i] = ext[i] ? 0 : 1;
  for (let k = 0; k < close; k++) solid = erode6(solid, nx, ny, nz);
  if (shrink === 0) { for (let i = 0; i < m.length; i++) if (surface[i]) solid[i] = 1; }
  for (let k = 0; k < shrink; k++) solid = erode6(solid, nx, ny, nz);
  return solid;
}

// Suggested shrink for a splat scan: median splat radius in voxels, rounded.
export function suggestShrink(radii, opac, minOpacity = 0.35) {
  const r = [];
  for (let i = 0; i < radii.length; i += Math.max(1, (radii.length / 5000) | 0)) if (opac[i] >= minOpacity) r.push(radii[i]);
  if (!r.length) return 0;
  r.sort((a, b) => a - b);
  return Math.min(3, Math.round(r[r.length >> 1]));
}

// Keep components with at least `frac` of the largest one (26-connectivity).
// Removes floaters from splat scans. Returns { mask, kept, removed }.
export function dropFloaters(mask, nx, ny, nz, frac = 0.05) {
  const n = nx * ny * nz, nxy = nx * ny;
  const label = new Int32Array(n);
  const q = new Int32Array(n);
  const sizes = [0];
  let lab = 0;
  for (let s = 0; s < n; s++) {
    if (!mask[s] || label[s]) continue;
    lab++;
    let head = 0, tail = 0, size = 0;
    label[s] = lab; q[tail++] = s;
    while (head < tail) {
      const i = q[head++]; size++;
      const x = i % nx, y = ((i / nx) | 0) % ny, z = (i / nxy) | 0;
      for (let dz = -1; dz <= 1; dz++) {
        const zz = z + dz; if (zz < 0 || zz >= nz) continue;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy; if (yy < 0 || yy >= ny) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx; if (xx < 0 || xx >= nx) continue;
            const j = xx + nx * yy + nxy * zz;
            if (mask[j] && !label[j]) { label[j] = lab; q[tail++] = j; }
          }
        }
      }
    }
    sizes.push(size);
  }
  let largest = 0;
  for (const s of sizes) if (s > largest) largest = s;
  const keep = sizes.map((s, i) => i > 0 && s >= Math.max(1, frac * largest));
  const out = new Uint8Array(n);
  let removed = 0;
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    if (keep[label[i]]) out[i] = 1; else removed++;
  }
  return { mask: out, kept: keep.filter(Boolean).length, removed };
}

// Analytic masks (tests + demo shapes)
export function sphereMask(nx, ny, nz, cx, cy, cz, r) {
  const m = new Uint8Array(nx * ny * nz);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const dx = x - cx, dy = y - cy, dz = z - cz;
    if (dx * dx + dy * dy + dz * dz <= r * r) m[x + nx * (y + ny * z)] = 1;
  }
  return m;
}

// Dilate a mask k times (6-connected).
export function grow(mask, nx, ny, nz, k = 1) {
  let m = mask;
  for (let i = 0; i < k; i++) m = dilate6(m, nx, ny, nz);
  return m;
}

// Bounds of a splat scan that ignore stray floaters: per-axis 0.5-99.5 percentiles
// of the reasonably opaque splats (sampled, so it stays fast on million-splat files).
export function robustBounds(pos, opacity, minOpacity = 0.35) {
  const n = pos.length / 3;
  const step = Math.max(1, Math.floor(n / 200000));
  const ax = [[], [], []];
  for (let i = 0; i < n; i += step) {
    if (opacity && opacity[i] < minOpacity) continue;
    for (let k = 0; k < 3; k++) ax[k].push(pos[3 * i + k]);
  }
  if (ax[0].length < 20) return bounds(pos);
  const min = [], max = [];
  for (let k = 0; k < 3; k++) {
    const a = Float32Array.from(ax[k]).sort();
    min.push(a[Math.floor(a.length * 0.005)]);
    max.push(a[Math.min(a.length - 1, Math.ceil(a.length * 0.995))]);
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}
