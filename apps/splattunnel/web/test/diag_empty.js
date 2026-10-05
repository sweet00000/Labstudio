// Empty tunnel with a floor: any pressure/velocity disturbance is a boundary artifact.
import { getDevice } from './gpu.js';
import { LBM, halfToFloat } from '../src/lbm.js';
import { buildTunnel } from '../src/voxelize.js';
const [nx, ny, nz] = [96, 40, 40];
const t = buildTunnel(new Uint8Array(nx * ny * nz), nx, ny, nz, { ground: true });
const { device } = await getDevice({ f16: false });
const lbm = new LBM(device, { nx, ny, nz, f16: false });
await lbm.build({ sync: true });
lbm.setPhysics({ nu: +(Deno.args[0] || 2e-4), cs: 0.17, u: [0.08, 0, 0] });
lbm.setFlags(t.flags); lbm.setBoundaryCells(new Uint32Array(0)); lbm.reset();
const enc = device.createCommandEncoder(); lbm.encodeSteps(enc, 1000); device.queue.submit([enc.finish()]);
const v = await lbm.readVelocity();
const zc = 20;
const at = (x, y, k) => halfToFloat(v[4 * (x + nx * (y + ny * zc)) + k]);
for (const x of [1, 2, 3, 10, 48, 94]) console.log(`x=${String(x).padStart(2)} ux/U y=1..8: ${Array.from({ length: 8 }, (_, i) => (at(x, i + 1, 0) / 0.08).toFixed(2)).join(' ')}  rho-1 y=1..4: ${Array.from({ length: 4 }, (_, i) => at(x, i + 1, 3).toExponential(1)).join(' ')}`);
Deno.exit(0);
