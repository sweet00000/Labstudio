// Headless test: splats -> voxels -> watertight mesh -> every export format.
import { sphereMask, rasterizeSplats, solidify, dropFloaters, suggestShrink } from '../src/voxelize.js';
import { surfaceNets, meshStats } from '../src/mesher.js';
import { toSTL, toOBJ, toPLYMesh, toGLB, to3MF, toSplatPLY, toVTK, toCSV } from '../src/export.js';
import { parseBuffer } from '../src/loaders.js';

const ok = (c, m) => { if (!c) { console.log('FAIL', m); Deno.exit(1); } console.log('ok  ', m); };

// 1) solid sphere mesh
const N = 48, R = 15;
const solid = sphereMask(N, N, N, 23.5, 23.5, 23.5, R);
let m = surfaceNets(solid, N, N, N);
let s = meshStats(m.pos, m.idx);
console.log('sphere mesh', s);
const exact = 4 / 3 * Math.PI * R ** 3;
ok(s.watertight, 'sphere mesh is watertight (no open or non-manifold edges)');
ok(s.volume > 0, 'outward normals (positive signed volume)');
ok(Math.abs(s.volume / exact - 1) < 0.06, `volume within 6% of exact (${(100 * (s.volume / exact - 1)).toFixed(2)}%)`);

// 2) fake Gaussian-splat scan: surface splats of a box + floaters
const pts = [], rad = [], op = [];
const rnd = (() => { let x = 12345; return () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); })();
for (let i = 0; i < 20000; i++) {
  const f = Math.floor(rnd() * 6), u = rnd() * 2 - 1, v = rnd() * 2 - 1;
  const p = [[1, u, v], [-1, u, v], [u, 1, v], [u, -1, v], [u, v, 1], [u, v, -1]][f];
  pts.push(24 + 12 * p[0], 24 + 8 * p[1], 24 + 6 * p[2]); rad.push(1.2); op.push(0.9);
}
for (let i = 0; i < 40; i++) { pts.push(3 + rnd() * 42, 3 + rnd() * 42, 3 + rnd() * 5); rad.push(0.8); op.push(0.8); } // floaters
const surf = rasterizeSplats(Float32Array.from(pts), Float32Array.from(rad), Float32Array.from(op), N, N, N);
const shrink = suggestShrink(Float32Array.from(rad), Float32Array.from(op));
console.log('suggested shrink', shrink);
const clean = dropFloaters(surf, N, N, N, 0.05);
ok(clean.removed > 0, `floater removal dropped ${clean.removed} voxels`);
const filled = solidify(clean.mask, N, N, N, 1, shrink);
let low = 0; for (let z = 0; z < 10; z++) for (let i = 0; i < N * N; i++) low += filled[i + N * N * z];
ok(low === 0, 'no floater voxels survive near the floor');
m = surfaceNets(filled, N, N, N);
s = meshStats(m.pos, m.idx);
console.log('splat-box mesh', s);
ok(s.watertight, 'splat scan mesh is watertight');
const boxVol = 24 * 16 * 12;
ok(Math.abs(s.volume / boxVol - 1) < 0.20, `box volume within 20% (~1 voxel on a 12-voxel-thick box) (${(100 * (s.volume / boxVol - 1)).toFixed(1)}%)`);

// 3) write every format, then read the mesh ones back with our own loaders
const col = new Uint8Array(m.pos.length / 3 * 4).fill(180);
const mesh = { pos: m.pos, idx: m.idx, col };
const files = {
  'body.stl': toSTL(mesh), 'body.obj': toOBJ(mesh), 'body.ply': toPLYMesh(mesh),
  'body.glb': toGLB([{ name: 'body', ...mesh, color: [0.14, 0.26, 0.66, 1] }], { extras: { cd: 1.05, units: 'mm' } }),
  'body.3mf': to3MF(mesh, { unit: 'millimeter' }),
};
for (const [name, bytes] of Object.entries(files)) {
  await Deno.writeFile(`out/${name}`, bytes);
  if (name.endsWith('.3mf')) continue;
  const back = parseBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), name);
  const bs = meshStats(back.pos, back.idx);
  ok(bs.triangles === s.triangles && Math.abs(bs.volume - s.volume) < 1e-3 * s.volume, `${name} round-trips (${bs.triangles} tris, ${bytes.length} bytes)`);
}

// 4) splat PLY (cleaned) round trip
const n = pts.length / 3;
const splats = { pos: Float32Array.from(pts), scale: Float32Array.from(rad.flatMap((r) => [r, r, r])), rot: new Float32Array(4 * n).map((_, i) => (i % 4 === 0 ? 1 : 0)), opacity: Float32Array.from(op), col: new Uint8Array(4 * n).fill(200) };
const keep = new Uint8Array(n).fill(1); for (let i = n - 40; i < n; i++) keep[i] = 0;
const sp = toSplatPLY(splats, keep);
await Deno.writeFile('out/cleaned.splat.ply', sp);
const back = parseBuffer(sp.buffer, 'x.ply');
ok(back.kind === 'splats' && back.pos.length / 3 === n - 40, `cleaned splat PLY keeps ${n - 40}/${n} splats`);
ok(Math.abs(back.opacity[0] - 0.9) < 1e-4 && Math.abs(back.scale[0] - 1.2) < 1e-4, 'splat opacity/scale survive the logit/log encoding');

// 5) VTK + CSV
const nx = 8, ny = 6, nz = 4, nn = nx * ny * nz;
const vel = new Float32Array(3 * nn).map((_, i) => (i % 3 === 0 ? 10 : 0));
await Deno.writeFile('out/flow.vtk', toVTK({ nx, ny, nz, spacing: 0.01, origin: [0, 0, 0], vel, p: new Float32Array(nn).fill(-3.5), flags: new Uint8Array(nn) }));
await Deno.writeFile('out/forces.csv', toCSV([[100, 1.02, 0.01], [200, 1.01, 0.02]], ['step', 'cd', 'cl']));
console.log('ALL EXPORT TESTS PASSED');
