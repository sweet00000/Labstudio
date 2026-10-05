// Validation: drag on a sphere at Re=50 vs Schiller-Naumann, with f16 vs f32 storage.
// usage: deno run --unstable-webgpu -A test/lbm_sphere.js [f16|f32] [nx,ny,nz,R,steps]
import { getDevice } from './gpu.js';
import { LBM, halfToFloat } from '../src/lbm.js';
import { buildTunnel, sphereMask } from '../src/voxelize.js';

const { device, f16 } = await getDevice({ f16: Deno.args[0] !== 'f32' });
const [nx, ny, nz, R, total] = (Deno.args[1] || '80,40,40,5,3000').split(',').map(Number);
const body = sphereMask(nx, ny, nz, Math.round(nx * 0.3), ny / 2 - 0.5, nz / 2 - 0.5, R);
const t = buildTunnel(body, nx, ny, nz, { ground: false });
console.log(`f16=${f16} cells=${nx * ny * nz} body=${t.bodyCount} frontal=${t.frontalArea} blockage=${(100 * t.blockage).toFixed(1)}%`);
const U = 0.05, Re = 50, nu = U * 2 * R / Re;
const lbm = new LBM(device, { nx, ny, nz, f16 });
await lbm.build({ sync: true });
lbm.setPhysics({ nu, cs: 0.17, u: [U, 0, 0] });
lbm.setFlags(t.flags);
lbm.setBoundaryCells(t.boundaryCells);
lbm.reset();
const t0 = performance.now();
let cd = 0;
for (let s = 0; s < total; s += 500) {
  const enc = device.createCommandEncoder();
  lbm.encodeSteps(enc, Math.min(500, total - s));
  const st = lbm.encodeForce(enc);
  device.queue.submit([enc.finish()]);
  const F = await lbm.readForce(st);
  cd = 2 * F[0] / (U * U * t.frontalArea);
  console.log(`step ${lbm.stepCount}  Cd=${cd.toFixed(3)}  Cy=${(2 * F[1] / (U * U * t.frontalArea)).toFixed(4)}`);
}
const dt = (performance.now() - t0) / 1000;
const v = await lbm.readVelocity();
let nan = 0;
for (let c = 0; c < nx * ny * nz; c++) if (!Number.isFinite(halfToFloat(v[4 * c]))) nan++;
const ref = 24 / Re * (1 + 0.15 * Math.pow(Re, 0.687));
console.log(`MLUPS ${(nx * ny * nz * total / dt / 1e6).toFixed(1)}  nan=${nan}  Cd=${cd.toFixed(3)}  ref(unbounded)=${ref.toFixed(3)}`);
Deno.exit(nan ? 1 : 0);
