// Sample shapes, built from signed-distance functions and meshed with the same
// surface-nets mesher the scans go through. Sizes are real-world meters.
import { surfaceNets } from './mesher.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function roundBox(p, c, h, r) {
  const qx = Math.abs(p[0] - c[0]) - h[0] + r, qy = Math.abs(p[1] - c[1]) - h[1] + r, qz = Math.abs(p[2] - c[2]) - h[2] + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
}
function cylZ(p, c, r, h) {
  const d0 = Math.hypot(p[0] - c[0], p[1] - c[1]) - r, d1 = Math.abs(p[2] - c[2]) - h;
  return Math.min(Math.max(d0, d1), 0) + Math.hypot(Math.max(d0, 0), Math.max(d1, 0));
}
const smin = (a, b, k) => { const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1); return b * (1 - h) + a * h - k * h * (1 - h); };

// NACA 00xx half-thickness at chord fraction x
const naca = (x, t) => 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);

const SAMPLES = {
  car: {
    label: 'Hatchback', length: 4.2, ground: true,
    box: [[-0.1, 0, -0.95], [4.3, 1.55, 0.95]],
    sdf: (p) => {
      const body = roundBox(p, [2.1, 0.62, 0], [2.08, 0.34, 0.86], 0.28);
      // cabin: a box tapered toward the back, sheared forward windscreen
      const t = clamp((p[0] - 1.3) / 2.6, 0, 1);
      const cabin = roundBox([p[0] + (p[1] - 1.0) * 0.6, p[1], p[2]], [2.55, 1.12, 0], [1.2, 0.3, 0.74 - 0.08 * t], 0.22);
      let d = smin(body, cabin, 0.2);
      for (const x of [0.85, 3.3]) for (const z of [-0.78, 0.78]) d = Math.min(d, cylZ(p, [x, 0.33, z], 0.33, 0.11));
      return d;
    },
  },
  sphere: {
    label: 'Sphere', length: 0.22, ground: false,
    box: [[-0.12, -0.12, -0.12], [0.12, 0.12, 0.12]],
    sdf: (p) => Math.hypot(p[0], p[1], p[2]) - 0.11,
  },
  cube: {
    label: 'Cube', length: 1.0, ground: true,
    box: [[-0.55, -0.05, -0.55], [0.55, 1.05, 0.55]],
    sdf: (p) => roundBox(p, [0, 0.5, 0], [0.5, 0.5, 0.5], 0.01),
  },
  wing: {
    label: 'Wing', length: 1.0, ground: false,
    box: [[-0.05, -0.12, -0.52], [1.05, 0.12, 0.52]],
    // NACA 0012, 8 degrees angle of attack, 1 m span x 0.5 m chord
    sdf: (p) => {
      const a = 8 * Math.PI / 180;
      const x = (p[0] - 0.25) * Math.cos(a) - p[1] * Math.sin(a) + 0.25;
      const y = (p[0] - 0.25) * Math.sin(a) + p[1] * Math.cos(a);
      const xc = clamp(x / 0.5, 0, 1);
      const half = naca(xc, 0.12) * 0.5;
      let d = Math.abs(y) - half;
      if (x < 0) d = Math.max(d, Math.hypot(x, y));
      if (x > 0.5) d = Math.max(d, x - 0.5);
      return Math.max(d, Math.abs(p[2]) - 0.5);
    },
  },
};

export const sampleNames = Object.keys(SAMPLES);

// Returns a mesh in meters: { kind:'mesh', pos, idx, col:null, meta }
export function makeSample(name, res = 72) {
  const s = SAMPLES[name];
  const [lo, hi] = s.box;
  const size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const h = Math.max(...size) / res;
  const n = size.map((v) => Math.ceil(v / h) + 1);
  const solid = new Uint8Array(n[0] * n[1] * n[2]);
  for (let k = 0; k < n[2]; k++) for (let j = 0; j < n[1]; j++) for (let i = 0; i < n[0]; i++) {
    const p = [lo[0] + i * h, lo[1] + j * h, lo[2] + k * h];
    if (s.sdf(p) <= 0) solid[i + n[0] * (j + n[1] * k)] = 1;
  }
  const m = surfaceNets(solid, n[0], n[1], n[2], { smooth: true });
  const pos = m.pos;
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] = lo[0] + pos[i] * h; pos[i + 1] = lo[1] + pos[i + 1] * h; pos[i + 2] = lo[2] + pos[i + 2] * h;
  }
  return { kind: 'mesh', pos, idx: m.idx, col: null, meta: { sample: name, label: s.label, length: s.length, ground: s.ground } };
}
