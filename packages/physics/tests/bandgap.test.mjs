// Band-gap kernel checks against published room-temperature values and exact limits.
// Literature targets: GaAs 1.424 eV, InAs 0.354 eV, Si 1.12 eV at 300 K;
// In0.53Ga0.47As (lattice-matched to InP) ≈ 0.74–0.75 eV; AlGaAs turns indirect near x ≈ 0.4.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../bandgap.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} ± ${tol}`);

test('photon energy and wavelength are inverse, hc = 1239.84 eV·nm', () => {
  near(B.HC_EV_NM, 1239.84198, 1e-5, 'hc');
  near(B.photonEnergyEV(B.HC_EV_NM), 1, 1e-12, '1 eV photon');
  near(B.wavelengthNm(B.photonEnergyEV(633)), 633, 1e-9, 'round trip');
});

test('Varshni reproduces room-temperature gaps', () => {
  near(B.gapAt('GaAs', 300).Eg, 1.424, 0.003, 'GaAs');
  near(B.gapAt('InAs', 300).Eg, 0.354, 0.003, 'InAs');
  near(B.gapAt('Si', 300).Eg, 1.12, 0.006, 'Si');
  assert.equal(B.gapAt('Si', 300).direct, false, 'Si is indirect');
  near(B.gapAt('GaAs', 0).Eg, 1.519, 1e-12, 'T = 0 gives Eg0');
  assert.ok(B.gapAt('GaAs', 400).Eg < B.gapAt('GaAs', 300).Eg, 'gap shrinks as it warms');
});

test('alloys: InGaAs lattice-matched to InP, and AlGaAs direct-to-indirect crossover', () => {
  near(B.alloyGap('InGaAs', 0.53, 300).Eg, 0.745, 0.015, 'In0.53Ga0.47As');
  near(B.alloyGap('InGaAs', 0, 300).Eg, B.gapAt('GaAs', 300).Eg, 1e-12, 'x = 0 is GaAs');
  near(B.alloyGap('InGaAs', 1, 300).Eg, B.gapAt('InAs', 300).Eg, 1e-12, 'x = 1 is InAs');
  assert.equal(B.alloyGap('AlGaAs', 0.3, 300).direct, true);
  assert.equal(B.alloyGap('AlGaAs', 0.6, 300).direct, false);
  let x = 0; while (B.alloyGap('AlGaAs', x, 300).direct) x += 0.001;
  assert.ok(x > 0.35 && x < 0.48, `crossover at x = ${x.toFixed(3)}`);
  const xFor1550 = B.compositionFor('InGaAs', B.photonEnergyEV(1550), 300);
  near(B.alloyGap('InGaAs', xFor1550, 300).Eg, B.photonEnergyEV(1550), 1e-9, 'inverse design hits the target');
});

test('confinement: wells and dots raise the gap as 1/L², and the Brus model returns to bulk', () => {
  const { me, mhh } = B.MATERIALS.GaAs;
  near(B.quantumWellShift(5, me, mhh) / B.quantumWellShift(10, me, mhh), 4, 1e-12, '1/L²');
  near(B.quantumWellShift(10, me, mhh), 0.0669, 0.002, 'GaAs 10 nm infinite well, e1 + hh1');
  const cdse = { Eg: B.MATERIALS.CdSe.gamma300, me: B.MATERIALS.CdSe.me, mh: B.MATERIALS.CdSe.mhh, epsR: B.MATERIALS.CdSe.epsR };
  near(B.brusGap(1e6, cdse), cdse.Eg, 1e-6, 'large dot → bulk');
  assert.ok(B.brusGap(2, cdse) > B.brusGap(3, cdse) && B.brusGap(3, cdse) > B.brusGap(5, cdse), 'smaller is bluer');
  near(B.brusGap(2, cdse), 2.55, 0.05, 'CdSe R = 2 nm (Brus; experiment is lower, about 2.2–2.3 eV)');
});

test('strain and doping shifts have the right sign and scaling', () => {
  // Compressive (layer bigger than substrate) with a negative gap deformation potential opens the gap.
  const g = B.MATERIALS.GaAs;
  const s = B.biaxialStrainShift({ aLayer: 5.73, aSub: g.a, deformA: g.deformA, C11: g.C11, C12: g.C12 });
  assert.ok(s.ePar < 0 && s.ePerp > 0 && s.dEg > 0);
  const bm = (n) => B.bursteinMossShift(n, g.me, g.mhh);
  near(bm(8e19) / bm(1e19), 4, 1e-9, 'n^(2/3)');
  near(bm(1e19), 0.30, 0.03, 'GaAs at 1e19 cm⁻³ (parabolic, no renormalization)');
});

test('photoelectric relations', () => {
  near(B.photoelectronMaxKE(B.photonEnergyEV(400), 2.1), B.photonEnergyEV(400) - 2.1, 1e-12, 'Einstein');
  assert.equal(B.photoelectronMaxKE(1.5, 2.1), 0, 'below the work function nothing escapes');
  near(B.responsivity(B.HC_EV_NM, 1), 1, 1e-12, 'η = 1 at 1239.84 nm is 1 A/W');
  assert.equal(B.responsivity(1700, 0.8, B.gapAt('InP', 300).Eg), 0, 'below-gap light gives no photocurrent');
  near(B.cutoffNm(B.alloyGap('InGaAs', 0.53, 300).Eg), 1665, 40, 'InGaAs detectors cut off near 1.65–1.7 µm');
});

test('AC photoresponse: RC and transit limits combine in quadrature', () => {
  const r = B.acPhotoresponse(0, { R: 50, C: 1e-12, transit: 10e-12 });
  near(r.fRC, 3.183e9, 1e6, 'f_RC for 50 Ω, 1 pF');
  near(r.fT, 44.3e9, 1e6, 'f_T for 10 ps');
  near(r.f3dB, 1 / Math.hypot(1 / r.fT, 1 / r.fRC), 1, 'combined');
  const at = B.acPhotoresponse(r.f3dB, { R: 50, C: 1e-12, transit: 10e-12 });
  near(at.gain, Math.SQRT1_2, 1e-12, '−3 dB at f_3dB'); near(at.phaseDeg, -45, 1e-9, '−45° at f_3dB');
});

test('Tauc analysis recovers the gap from a synthetic absorption edge', () => {
  for (const direct of [true, false]) {
    const Eg = 1.42, pts = Array.from({ length: 20 }, (_, i) => { const E = 1.45 + i * 0.02; return [E, B.absorption(E, Eg, 1e4, direct)]; });
    near(B.taucGap(pts, direct), Eg, 1e-9, direct ? 'direct' : 'indirect');
  }
});
