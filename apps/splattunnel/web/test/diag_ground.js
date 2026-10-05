import { getDevice } from './gpu.js';
import { LBM, halfToFloat } from '../src/lbm.js';
import { bounds, tunnelGrid, fitTransform, applyTransform, rasterizeMesh, solidify, buildTunnel } from '../src/voxelize.js';
import { makeSample } from '../src/samples.js';
const s = makeSample('cube');
const b = bounds(s.pos);
const GROUND = Deno.args[0] !== 'free';
const g = tunnelGrid(b, 16, GROUND); const { nx, ny, nz } = g;
const tf = fitTransform(b, nx, ny, nz, { bodyCells: 16, ground: GROUND, x0: g.x0 });
const solid = solidify(rasterizeMesh(applyTransform(s.pos, tf), s.idx, nx, ny, nz), nx, ny, nz, 1, 0);
const t = buildTunnel(solid, nx, ny, nz, { ground: GROUND });
const zc = Math.round(nz / 2);
const col = (x) => Array.from({ length: 20 }, (_, y) => t.flags[x + nx * (y + ny * zc)]).join('');
console.log('bbox', t.bbox, 'x0', g.x0);
console.log('flags column through cube (y=0..19):', col(t.bbox[0] + 2));
const { device, f16 } = await getDevice();
const lbm = new LBM(device, { nx, ny, nz, f16 });
await lbm.build({ sync: true });
lbm.setPhysics({ nu: 2e-4, cs: 0.17, u: [0.08, 0, 0] });
lbm.setFlags(t.flags); lbm.setBoundaryCells(t.boundaryCells); lbm.reset();
const enc = device.createCommandEncoder(); lbm.encodeSteps(enc, 1200); device.queue.submit([enc.finish()]);
const v = await lbm.readVelocity();
const ux = (x, y, z) => halfToFloat(v[4 * (x + nx * (y + ny * z))]);
const rho = (x, y, z) => halfToFloat(v[4 * (x + nx * (y + ny * z)) + 3]);
for (const x of [2, 10, t.bbox[0] - 4, t.bbox[3] + 20, nx - 3]) {
  console.log(`x=${x} ux/U y=1..12:`, Array.from({ length: 12 }, (_, i) => (ux(x, i + 1, zc) / 0.08).toFixed(2)).join(' '), ' top:', (ux(x, ny - 3, zc) / 0.08).toFixed(2));
}
console.log('rho-1 along centerline y=ny/2:', [2, 20, 40, t.bbox[0] - 2, t.bbox[3] + 5, nx - 20, nx - 3].map((x) => `${x}:${rho(x, Math.round(ny / 2), zc).toExponential(1)}`).join(' '));
console.log('rho-1 at y=2:', [2, 20, 40, t.bbox[0] - 2, t.bbox[3] + 5, nx - 20, nx - 3].map((x) => `${x}:${rho(x, 2, zc).toExponential(1)}`).join(' '));
// independent check: pressure integrated over the cube's front and back faces vs momentum exchange
const [x0b, y0b, z0b, x1b, y1b, z1b] = t.bbox;
let pf = 0, pb = 0;
for (let y = y0b; y <= y1b; y++) for (let z = z0b; z <= z1b; z++) { pf += rho(x0b - 1, y, z) / 3; pb += rho(x1b + 1, y, z) / 3; }
const enc2 = device.createCommandEncoder(); const st = lbm.encodeForce(enc2); device.queue.submit([enc2.finish()]);
const F = await lbm.readForce(st);
const q = 0.5 * 0.08 * 0.08 * t.frontalArea;
console.log(`pressure-only Cd ~ ${((pf - pb) / q).toFixed(3)}   momentum-exchange Cd = ${(F[0] / q).toFixed(3)}  Cl = ${(F[1] / q).toFixed(3)}  (frontal ${t.frontalArea} cells)`);
Deno.exit(0);
