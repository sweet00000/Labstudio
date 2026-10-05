// Break momentum-exchange drag down by body face, from raw populations on the CPU.
import { getDevice } from './gpu.js';
import { LBM, C, OPP, halfToFloat } from '../src/lbm.js';
import { bounds, tunnelGrid, fitTransform, applyTransform, rasterizeMesh, solidify, buildTunnel } from '../src/voxelize.js';
import { makeSample } from '../src/samples.js';
const GROUND = Deno.args[0] !== 'free';
const steps = +(Deno.args[1] || 1200);
const s = makeSample(Deno.args[2] || 'cube'); const b = bounds(s.pos);
const BC = +(Deno.args[3] || 16);
const g = tunnelGrid(b, BC, GROUND); const { nx, ny, nz } = g; const n = nx * ny * nz;
const tf = fitTransform(b, nx, ny, nz, { bodyCells: BC, ground: GROUND, x0: g.x0 });
const t = buildTunnel(solidify(rasterizeMesh(applyTransform(s.pos, tf), s.idx, nx, ny, nz), nx, ny, nz, 1, 0), nx, ny, nz, { ground: GROUND });
const { device } = await getDevice({ f16: false });
const lbm = new LBM(device, { nx, ny, nz, f16: false });
await lbm.build({ sync: true });
lbm.setPhysics({ nu: 2e-4, cs: 0.17, u: [0.08, 0, 0] });
lbm.setFlags(t.flags); lbm.setBoundaryCells(t.boundaryCells); lbm.reset();
const enc = device.createCommandEncoder(); lbm.encodeSteps(enc, steps);
const st = device.createBuffer({ size: lbm.popBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
enc.copyBufferToBuffer(lbm.f[lbm.cur], 0, st, 0, lbm.popBytes);
const fst = lbm.encodeForce(enc);
device.queue.submit([enc.finish()]);
await st.mapAsync(GPUMapMode.READ); const f = new Float32Array(st.getMappedRange().slice(0)); st.unmap();
const Fgpu = await lbm.readForce(fst);
const [x0, y0, z0, x1, y1, z1] = t.bbox;
const bins = {};
const add = (k, v) => { bins[k] = (bins[k] || 0) + v; };
for (const c of t.boundaryCells) {
  const x = c % nx, y = Math.floor(c / nx) % ny, z = Math.floor(c / (nx * ny));
  const region = x < x0 ? 'front' : x > x1 ? 'back' : y > y1 ? 'top' : (z < z0 || z > z1) ? 'sides' : y <= 4 ? 'low y<=4' : 'mid y>4';
  for (let i = 1; i < 19; i++) {
    const nb = c - (C[i][0] + nx * (C[i][1] + ny * C[i][2]));
    if (t.flags[nb] !== 1) continue;
    const fx = -2 * f[OPP[i] * n + c] * C[i][0];
    add(`${region} ${C[i][0] === 0 ? 'x0' : 'x' + C[i][0]}${C[i][1] || C[i][2] ? ' diag' : ''}`, fx);
  }
}
const q = 0.5 * 0.08 * 0.08 * t.frontalArea;
console.log(GROUND ? 'GROUND' : 'FREE', 'gpu Cd', (Fgpu[0] / q).toFixed(3));
for (const [k, v] of Object.entries(bins).sort()) if (Math.abs(v / q) > 0.005) console.log(`  ${k.padEnd(22)} ${(v / q).toFixed(3)}`);
Deno.exit(0);
