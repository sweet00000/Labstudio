// Synthetic 3DGS-style PLY: splats scattered on the hatchback surface + floaters,
// with the full property layout real trainers write (normals, f_dc, 45 f_rest, opacity, scale, rot).
import { makeSample } from '../src/samples.js';
import { toSplatPLY } from '../src/export.js';
const s = makeSample('car', 64);
const props = ['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2', ...Array.from({ length: 45 }, (_, i) => `f_rest_${i}`), 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const N = 120000, F = 600, n = N + F;
const raw = Object.fromEntries(props.map((p) => [p, new Float32Array(n)]));
const tris = s.idx.length / 3;
for (let k = 0; k < N; k++) {
  const t = Math.floor(rnd() * tris); let u = rnd(), v = rnd(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
  const [a, b, c] = [s.idx[3 * t], s.idx[3 * t + 1], s.idx[3 * t + 2]];
  for (let d = 0; d < 3; d++) raw['xyz'[d]][k] = s.pos[3 * a + d] * (1 - u - v) + s.pos[3 * b + d] * u + s.pos[3 * c + d] * v;
  raw.f_dc_0[k] = 0.4; raw.f_dc_1[k] = -0.6; raw.f_dc_2[k] = -1.2;
  raw.opacity[k] = 3.0; raw.scale_0[k] = Math.log(0.02); raw.scale_1[k] = Math.log(0.02); raw.scale_2[k] = Math.log(0.004); raw.rot_0[k] = 1;
}
for (let k = N; k < n; k++) { // floaters: faint fog + a few opaque blobs in the air
  raw.x[k] = -1 + rnd() * 6; raw.y[k] = 1.8 + rnd() * 1.5; raw.z[k] = -1.5 + rnd() * 3;
  raw.opacity[k] = k % 5 ? -2 : 2; raw.scale_0[k] = raw.scale_1[k] = raw.scale_2[k] = Math.log(0.03); raw.rot_0[k] = 1;
}
const bytes = toSplatPLY({ pos: new Float32Array(3 * n), raw, rawProps: props });
await Deno.writeFile('out/hatchback_scan.ply', bytes);
console.log('wrote', n, 'splats,', (bytes.length / 1e6).toFixed(1), 'MB,', props.length, 'properties');
