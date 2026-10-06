// Starting models. Each returns features tagged with a `group`, so a template can be
// regenerated in place (for example after the optics change) without touching the
// user's own features.
import { makeFeature } from './cad.js';
import { DEFAULTS as OPTICS_DEFAULTS, sag } from '../../../mirrorlab/web/src/physics.js';
import { makeSample } from '../../../../packages/geometry/samples.js';

// Mirrorlab works in mm with Y up and the optical axis along +Z (mirror vertex at the
// origin, eye at +Z). The workspace is Z up, so optics (x, y, z) → workspace (x, −z, y):
// the display sits on top and the eye looks out along −Y.
export const opticsToWorld = ([x, y, z]) => [x, -z, y];

// A printable birdbath housing around the current Mirrorlab design, plus the optics as
// reference bodies. Every dimension is derived from the optics parameters.
export function birdbathHousing(optics = OPTICS_DEFAULTS, { wall = 3, mirrorBack = 3 } = {}) {
  const p = { ...OPTICS_DEFAULTS, ...optics };
  const group = 'birdbath';
  const a = p.aperture / 2, b = p.splitterZ, S = p.splitterSize, top = p.distance - p.splitterZ;
  const reach = S / (2 * Math.SQRT2); // splitter extent along y and z from its centre
  const edgeSag = p.surface === 'flat' ? 0 : sag(a, p);
  const half = Math.max(S / 2 - 1, a + 2.7); // cavity half-width: splitter edges sit in the walls
  const lip = 0.8;
  // Optics-space ranges [lo, hi] for x, y, z → a workspace box feature.
  const box = (name, op, xr, yr, zr, extra = {}) => {
    const c = opticsToWorld([(xr[0] + xr[1]) / 2, (yr[0] + yr[1]) / 2, (zr[0] + zr[1]) / 2]);
    return makeFeature('box', { name, op, group, at: c, params: { x: xr[1] - xr[0], y: zr[1] - zr[0], z: yr[1] - yr[0] }, ...extra });
  };
  // Cylinder along the optical axis, spanning optics z0..z1.
  const axial = (name, op, r, z0, z1, extra = {}) =>
    makeFeature('cylinder', { name, op, group, at: opticsToWorld([0, 0, (z0 + z1) / 2]), rot: [90, 0, 0], params: { radius: r, top: r, height: z1 - z0 }, ...extra });

  const yLo = -Math.max(a + 0.5, reach + 2), yTop = top - lip; // cavity, optics y
  const zBack = -mirrorBack, zFront = b + reach + 0.5;         // cavity, optics z
  const f = [
    box('Housing', 'add', [-half - wall, half + wall], [yLo - wall, top + 2], [zBack - wall, zFront + wall]),
    box('Cavity', 'subtract', [-half, half], [yLo, yTop], [zBack, zFront]),
    axial('Mirror cell', 'add', a + 2.5, zBack, edgeSag),
    axial('Mirror bore', 'subtract', a + 0.15, zBack, edgeSag + 1),
    makeFeature('box', { name: 'Splitter slot', op: 'subtract', group, at: opticsToWorld([0, 0, b]), rot: [45, 0, 0], params: { x: S + 0.6, y: 1.2, z: S + 0.6 } }),
    box('Display window', 'subtract', [-p.width / 2 - 1, p.width / 2 + 1], [yTop - 1, top + 3], [b - p.height / 2 - 1, b + p.height / 2 + 1]),
    box('Display seat', 'subtract', [-p.width / 2 - 3, p.width / 2 + 3], [top, top + 3], [b - p.height / 2 - 3, b + p.height / 2 + 3]),
    axial('Eye window', 'subtract', Math.min(a, reach), zFront - 1, zFront + wall + 1),
  ];
  // Reference optics, never exported.
  const ref = { role: 'reference', group };
  f.push(axial('Mirror blank', 'add', a, zBack, edgeSag, ref));
  if (p.surface !== 'flat') {
    // The spherical cap that forms the mirror face (a paraboloid is shown as its osculating sphere).
    f.push(makeFeature('sphere', { name: 'Mirror face', op: 'subtract', ...ref, at: opticsToWorld([0, 0, p.radius]), params: { radius: p.radius } }));
  }
  f.push(makeFeature('box', { name: 'Splitter', op: 'add', ...ref, at: opticsToWorld([0, 0, b]), rot: [45, 0, 0], params: { x: S, y: 1, z: S } }));
  f.push(box('Display', 'add', [-p.width / 2, p.width / 2], [top, top + 1], [b - p.height / 2, b + p.height / 2], ref));
  f.push(makeFeature('sphere', { name: 'Eye pupil', op: 'add', ...ref, at: opticsToWorld([p.eyeX, p.eyeY, p.detectorZ]), params: { radius: p.pupil / 2 } }));
  return f;
}

// The wind tunnel's hatchback sample (4.2 m), as a mesh asset in mm, Z up.
export function hatchback() {
  const s = makeSample('car');
  const pos = new Float32Array(s.pos.length);
  for (let i = 0; i < pos.length; i += 3) { pos[i] = s.pos[i] * 1000; pos[i + 1] = -s.pos[i + 2] * 1000; pos[i + 2] = s.pos[i + 1] * 1000; }
  return { asset: { name: 'Hatchback', source: 'sample:car', pos, idx: s.idx }, feature: { name: 'Hatchback body', group: 'hatchback' } };
}
