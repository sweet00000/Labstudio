// CAD core checks: kernel volumes against closed-form answers, the birdbath template
// against the optics it is built from, scan import, and project round trips.
import test from 'node:test';
import assert from 'node:assert/strict';
import Module from '../../../packages/vendor/manifold/manifold.js';
import { Evaluator, emptyDoc, makeFeature, analyze, meshFromManifold, manifoldFromMesh, placeOnBed, docToJSON, docFromJSON } from '../web/src/cad.js';
import { birdbathHousing, hatchback, opticsToWorld } from '../web/src/templates.js';
import { scanToSolid, toWorkspace } from '../web/src/scan.js';
import { DEFAULTS } from '../../mirrorlab/web/src/physics.js';
import { parseBuffer } from '../../../packages/geometry/loaders.js';
import { toSTL } from '../../../packages/geometry/export.js';

const wasm = await Module();
wasm.setup();
const run = (features, assets = {}) => {
  const ev = new Evaluator(wasm), doc = { ...emptyDoc(), features, assets };
  const r = ev.evaluate(doc);
  return { r, a: analyze(r.part), ref: analyze(r.reference) };
};
const near = (a, b, rel, msg) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${msg}: ${a} vs ${b}`);

test('box minus a through cylinder matches the closed-form volume', () => {
  const { a, r } = run([
    makeFeature('box', { params: { x: 40, y: 30, z: 20 } }),
    makeFeature('cylinder', { op: 'subtract', params: { radius: 5, top: 5, height: 50 } }),
  ]);
  assert.deepEqual(r.errors, {});
  near(a.volume, 40 * 30 * 20 - Math.PI * 25 * 20, 0.002, 'volume');
  assert.equal(a.genus, 1, 'one through-hole');
  assert.deepEqual(a.size.map(Math.round), [40, 30, 20]);
});

test('intersect keeps only the overlap, and transforms apply rotate-then-translate', () => {
  const { a } = run([
    makeFeature('box', { params: { x: 20, y: 20, z: 20 } }),
    makeFeature('box', { op: 'intersect', at: [10, 0, 0], params: { x: 20, y: 20, z: 20 } }),
  ]);
  near(a.volume, 10 * 20 * 20, 1e-9, 'half-overlap volume');
  const { a: b } = run([makeFeature('box', { at: [5, 0, 0], rot: [0, 0, 90], params: { x: 40, y: 10, z: 10 } })]);
  near(b.size[1], 40, 1e-6, 'rotated about Z, the long side lies along Y');
  near((b.min[0] + b.max[0]) / 2, 5, 1e-6, 'then moved to x = 5');
});

test('reference bodies never join the part, and bad features report instead of throwing', () => {
  const { r, a, ref } = run([
    makeFeature('sphere', { params: { radius: 10 } }),
    makeFeature('box', { role: 'reference', params: { x: 100, y: 100, z: 100 } }),
    makeFeature('box', { params: { x: -1, y: 5, z: 5 } }),
  ]);
  near(a.volume, (4 / 3) * Math.PI * 1000, 0.01, 'sphere volume');
  near(ref.volume, 1e6, 1e-9, 'reference box');
  assert.equal(Object.keys(r.errors).length, 1);
});

test('birdbath housing is a closed printable solid around the optics it was built from', () => {
  const { r, a, ref } = run(birdbathHousing(DEFAULTS));
  assert.deepEqual(r.errors, {});
  assert.ok(a.volume > 10_000 && a.volume < 100_000, `plausible housing volume ${a.volume}`);
  assert.equal(a.genus, 1, 'cavity opens at the eye and display windows only, so it is one handle');
  // The display sits in the splitter's fold plane, `distance − splitterZ` above the axis.
  const display = birdbathHousing(DEFAULTS).find((f) => f.name === 'Display');
  near(display.at[2] - 0.5, DEFAULTS.distance - DEFAULTS.splitterZ, 1e-9, 'display height');
  near(display.at[1], -DEFAULTS.splitterZ, 1e-9, 'display above the splitter centre');
  // The eye pupil sits at the Mirrorlab detector plane.
  const eye = birdbathHousing(DEFAULTS).find((f) => f.name === 'Eye pupil');
  assert.deepEqual(eye.at, opticsToWorld([DEFAULTS.eyeX, DEFAULTS.eyeY, DEFAULTS.detectorZ]));
  assert.ok(ref.min[1] <= -DEFAULTS.detectorZ, 'reference reaches the eye');
  // No housing material in the mirror's clear aperture in front of the mirror.
  const probe = wasm.Manifold.cylinder(DEFAULTS.splitterZ - 4, DEFAULTS.aperture / 2 - 0.5, DEFAULTS.aperture / 2 - 0.5, 64, false).rotate([90, 0, 0]).translate([0, -2, 0]);
  const clash = r.part.intersect(probe);
  assert.ok(clash.isEmpty() || clash.volume() < 1e-6, 'light path between mirror and splitter is clear');
});

test('the housing follows the optics: a bigger mirror makes a wider cell', () => {
  const small = run(birdbathHousing({ ...DEFAULTS, aperture: 30 })).a;
  const big = run(birdbathHousing({ ...DEFAULTS, aperture: 60, splitterSize: 70 })).a;
  assert.ok(big.size[0] > small.size[0] + 15);
});

test('hatchback sample comes in as a closed 4.2 m mesh in mm, Z up', () => {
  const h = hatchback();
  const { a } = run([makeFeature('mesh', { params: { asset: 'car', scale: 1 } })], { car: h.asset });
  near(a.size[0], 4200, 0.02, 'length along X');
  assert.ok(a.size[2] < a.size[1] && a.size[2] > 1200, 'height is Z');
});

test('scan import keeps a closed STL exactly and rebuilds a broken one', () => {
  const { r } = run([makeFeature('box', { params: { x: 10, y: 20, z: 30 } })]);
  const stl = parseBuffer(toSTL(meshFromManifold(r.part)).buffer, 'box.stl');
  const tryExact = (p, i) => { try { const m = manifoldFromMesh(wasm, p, i); const ok = !m.isEmpty(); m.delete(); return ok; } catch { return false; } };
  const exact = scanToSolid(stl, { unit: 'cm', tryExact });
  assert.equal(exact.method, 'exact');
  const m = manifoldFromMesh(wasm, exact.pos, exact.idx);
  near(m.volume(), 6000 * 1000, 1e-4, 'cm → mm scales volume by 1000');
  // A finely meshed sphere with two triangles missing is open, so it is rebuilt through voxels.
  const ball = meshFromManifold(run([makeFeature('sphere', { params: { radius: 20 } })]).r.part);
  const open = { kind: 'mesh', pos: ball.pos, idx: ball.idx.slice(6), col: null };
  const fixed = scanToSolid(open, { unit: 'mm', cells: 64, tryExact });
  assert.equal(fixed.method, 'voxel');
  const v = manifoldFromMesh(wasm, fixed.pos, fixed.idx).volume();
  near(v, (4 / 3) * Math.PI * 8000, 0.08, 'rebuilt volume close to the sphere');
});

test('Y-up and Y-down files turn so their up becomes +Z', () => {
  assert.deepEqual([...toWorkspace(new Float32Array([0, 1, 0]), { up: 'y' })], [0, -0, 1]);
  assert.deepEqual([...toWorkspace(new Float32Array([0, -1, 0]), { up: '-y' })], [0, 0, 1]);
});

test('place on bed rests the part on z = 0, centred', () => {
  const { r } = run([makeFeature('box', { at: [7, -3, 50], params: { x: 10, y: 10, z: 10 } })]);
  const m = placeOnBed(meshFromManifold(r.part));
  let zmin = Infinity, xs = 0;
  for (let i = 0; i < m.pos.length; i += 3) { zmin = Math.min(zmin, m.pos[i + 2]); xs = Math.max(xs, Math.abs(m.pos[i])); }
  assert.equal(zmin, 0); near(xs, 5, 1e-6, 'centred in X');
});

test('projects round-trip through JSON with mesh data intact', () => {
  const h = hatchback();
  const doc = { ...emptyDoc(), features: [...birdbathHousing(DEFAULTS), makeFeature('mesh', { params: { asset: 'car', scale: 0.01 } })], assets: { car: h.asset, unused: h.asset } };
  const back = docFromJSON(docToJSON(doc));
  assert.equal(back.features.length, doc.features.length);
  assert.deepEqual(Object.keys(back.assets), ['car'], 'unreferenced assets are dropped');
  assert.deepEqual([...back.assets.car.idx.slice(0, 9)], [...h.asset.idx.slice(0, 9)]);
  near(run(back.features, back.assets).a.volume, run(doc.features, doc.assets).a.volume, 1e-9, 'same solid');
  assert.throws(() => docFromJSON('{"schema":"other"}'), /isn’t a LabStudio project/);
});
