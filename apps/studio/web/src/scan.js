// Scan → solid. Brings any loaded file (mesh, Gaussian splats, point cloud) into the
// CAD workspace as a closed mesh in millimetres, Z up. Meshes that are already
// closed are kept exactly; everything else is rebuilt through a voxel grid.
import { robustBounds, bounds, rasterizeMesh, rasterizeSplats, solidify, dropFloaters, suggestShrink } from '../../../../packages/geometry/voxel.js';
import { surfaceNets, meshStats } from '../../../../packages/geometry/mesher.js';

export const UNIT_MM = { mm: 1, cm: 10, m: 1000, in: 25.4 };

// File coordinates → workspace (mm, Z up). Y-up files are turned so +Y becomes +Z;
// Y-down files (COLMAP and many splat captures) so −Y becomes +Z.
export function toWorkspace(pos, { unit = 'mm', up = 'z' } = {}) {
  const s = UNIT_MM[unit] ?? 1, out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i] * s, y = pos[i + 1] * s, z = pos[i + 2] * s;
    if (up === 'y') { out[i] = x; out[i + 1] = -z; out[i + 2] = y; }
    else if (up === '-y') { out[i] = x; out[i + 1] = z; out[i + 2] = -y; } // COLMAP-style, Y down
    else { out[i] = x; out[i + 1] = y; out[i + 2] = z; }
  }
  return out;
}

// Voxelize to `cells` across the longest side, close holes, drop floaters, re-mesh.
export function voxelRemesh(scan, pos, cells = 96, { minOpacity = 0.35 } = {}) {
  const b = scan.kind === 'splats' ? robustBounds(pos, scan.opacity, minOpacity) : bounds(pos);
  const h = Math.max(...b.size) / cells;
  if (!(h > 0)) throw new Error('The scan has no extent.');
  const pad = 4, n = b.size.map((v) => Math.ceil(v / h) + 2 * pad);
  const [nx, ny, nz] = n;
  if (nx * ny * nz > 64e6) throw new Error('That resolution needs too much memory. Lower it and try again.');
  const lat = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) lat[i + k] = (pos[i + k] - b.min[k]) / h + pad;
  let solid;
  if (scan.kind === 'mesh') {
    solid = dropFloaters(solidify(rasterizeMesh(lat, scan.idx, nx, ny, nz), nx, ny, nz, 1, 0), nx, ny, nz, 0.05).mask;
  } else {
    const count = lat.length / 3, radii = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const s = [scan.scale[3 * i], scan.scale[3 * i + 1], scan.scale[3 * i + 2]].map((v) => v * (UNIT_MM[scan._unit] ?? 1)).sort((a, c) => a - c);
      radii[i] = (1.5 * s[1]) / h;
    }
    const surf = rasterizeSplats(lat, radii, scan.opacity, nx, ny, nz, { minOpacity });
    const clean = dropFloaters(surf, nx, ny, nz, 0.05).mask;
    solid = solidify(clean, nx, ny, nz, 1, suggestShrink(radii, scan.opacity, minOpacity));
  }
  const m = surfaceNets(solid, nx, ny, nz, { smooth: true });
  if (!m.idx.length) throw new Error('Nothing solid was left after cleanup. Try a higher resolution.');
  for (let i = 0; i < m.pos.length; i += 3) for (let k = 0; k < 3; k++) m.pos[i + k] = (m.pos[i + k] - pad) * h + b.min[k];
  return { pos: m.pos, idx: m.idx, cellMm: h };
}

// Returns { pos, idx, method, note } ready to become a CAD asset.
// `tryExact(pos, idx)` should return true if the mesh is a valid closed solid.
export function scanToSolid(scan, { unit = 'mm', up = 'z', fitMm = 0, cells = 96, repair = 'auto', tryExact }) {
  let pos = toWorkspace(scan.pos, { unit, up });
  if (fitMm > 0) {
    const b = bounds(pos), k = fitMm / Math.max(...b.size);
    for (let i = 0; i < pos.length; i++) pos[i] *= k;
    if (scan.kind === 'splats') scan = { ...scan, scale: scan.scale.map((v) => v * k) };
  }
  scan = { ...scan, _unit: unit };
  if (scan.kind === 'mesh' && repair !== 'always') {
    const st = meshStats(pos, scan.idx);
    if (st.watertight && tryExact?.(pos, scan.idx)) return { pos, idx: scan.idx, method: 'exact', note: `${st.triangles.toLocaleString()} triangles, kept exactly.` };
    if (repair === 'never') throw new Error(`The mesh isn’t a closed solid (${st.openEdges} open edges, ${st.nonManifoldEdges} non-manifold). Turn on repair to rebuild it.`);
  }
  const r = voxelRemesh(scan, pos, cells);
  const what = scan.kind === 'mesh' ? 'Mesh had gaps, so it was rebuilt' : scan.points ? 'Points were turned into a solid' : 'Splats were turned into a solid';
  return { pos: r.pos, idx: r.idx, method: 'voxel', note: `${what} on a ${r.cellMm.toPrecision(3)} mm grid (${(r.idx.length / 3).toLocaleString()} triangles).` };
}
