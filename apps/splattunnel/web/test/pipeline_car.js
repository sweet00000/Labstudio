// End-to-end headless: sample car -> solid -> LBM at road-car Reynolds settings.
import { getDevice } from './gpu.js';
import { LBM } from '../src/lbm.js';
import { bounds, tunnelGrid, fitTransform, applyTransform, rasterizeMesh, solidify, dropFloaters, buildTunnel } from '../src/voxelize.js';
import { makeSample } from '../src/samples.js';
const which = Deno.args[0] || 'car';
const bodyCells = +(Deno.args[1] || 24), total = +(Deno.args[2] || 4000);
const s = makeSample(which);
const ground = Deno.args[3] ? Deno.args[3] === 'ground' : s.meta.ground;
const g = tunnelGrid(bounds(s.pos), bodyCells, ground);
const { nx, ny, nz } = g;
const tf = fitTransform(bounds(s.pos), nx, ny, nz, { bodyCells, ground, x0: g.x0 });
const lat = applyTransform(s.pos, tf);
const solid = dropFloaters(solidify(rasterizeMesh(lat, s.idx, nx, ny, nz), nx, ny, nz, 1, 0), nx, ny, nz, 0.05).mask;
const t = buildTunnel(solid, nx, ny, nz, { ground });
const U = 0.08, Re = 30 * s.meta.length / 1.51e-5;
const nu = Math.max(U * bodyCells / Re, 2e-4);
console.log(`${which}: grid ${nx}x${ny}x${nz}, body ${t.bodyCount} cells, blockage ${(100 * t.blockage).toFixed(1)}%, Re_real ${Re.toExponential(1)}, nu_lat ${nu}`);
const { device, f16 } = await getDevice();
const lbm = new LBM(device, { nx, ny, nz, f16 });
await lbm.build({ sync: true });
lbm.setPhysics({ nu, cs: 0.17, u: [U, 0, 0] });
lbm.setFlags(t.flags); lbm.setBoundaryCells(t.boundaryCells); lbm.reset();
const q = 0.5 * U * U * t.frontalArea;
const cds = [];
for (let k = 0; k < total; k += 250) {
  const enc = device.createCommandEncoder();
  lbm.encodeSteps(enc, 250);
  const st = lbm.encodeForce(enc);
  device.queue.submit([enc.finish()]);
  const F = await lbm.readForce(st);
  if (!F.every(Number.isFinite)) { console.log('UNSTABLE at step', lbm.stepCount); Deno.exit(1); }
  cds.push(F[0] / q);
  if ((k / 250) % 4 === 3) console.log(`step ${lbm.stepCount}: Cd ${(F[0] / q).toFixed(3)}  Cl ${(F[1] / q).toFixed(3)}`);
}
const tail = cds.slice(-6);
console.log(`STABLE. mean Cd over last ${tail.length} readings: ${(tail.reduce((a, b) => a + b) / tail.length).toFixed(3)}`);
Deno.exit(0);
