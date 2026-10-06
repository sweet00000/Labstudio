// Band-gap reference kernel: the textbook ways to tune a semiconductor's gap, plus the
// optoelectronic relations that turn a gap into something measurable. Pure functions,
// SI inside, eV / nm / K / cm⁻³ at the edges. No DOM, so it runs in tests and workers.
//
// This is a seed for a "Materials" workspace, not a band-structure code: every model
// here is parabolic-band, single-particle and isotropic unless stated. Each function
// says where it stops being valid. Parameters carry their source so they can be checked.

// ---------- constants (CODATA 2018, exact where defined) ----------
export const Q = 1.602176634e-19;          // C, also J per eV
export const H = 6.62607015e-34;           // J s
export const HBAR = H / (2 * Math.PI);
export const C0 = 299792458;               // m/s
export const KB = 1.380649e-23;            // J/K
export const M0 = 9.1093837015e-31;        // kg
export const EPS0 = 8.8541878128e-12;      // F/m
export const HC_EV_NM = (H * C0) / Q * 1e9; // 1239.84198… eV·nm

export const photonEnergyEV = (nm) => HC_EV_NM / nm;
export const wavelengthNm = (eV) => HC_EV_NM / eV;
// Confinement energy scale ħ²π²/(2 m0 L²) in eV for L in nm.
const confinementEV = (Lnm) => (HBAR ** 2 * Math.PI ** 2) / (2 * M0 * (Lnm * 1e-9) ** 2) / Q;

// ---------- materials ----------
// Varshni parameters: Eg(T) = Eg0 − αT²/(T + β), α in eV/K.
// VMR = Vurgaftman, Meyer & Ram-Mohan, J. Appl. Phys. 89, 5815 (2001), doi:10.1063/1.1368156.
export const MATERIALS = {
  GaAs: { gamma: { Eg0: 1.519, alpha: 5.405e-4, beta: 204 }, X: { Eg0: 1.981, alpha: 4.60e-4, beta: 204 }, me: 0.067, mhh: 0.35, epsR: 12.9, a: 5.65325, deformA: -8.33, C11: 1221, C12: 566, source: 'VMR 2001' },
  AlAs: { gamma: { Eg0: 3.099, alpha: 8.85e-4, beta: 530 }, X: { Eg0: 2.24, alpha: 7.0e-4, beta: 530 }, me: 0.15, mhh: 0.47, epsR: 10.1, a: 5.6611, source: 'VMR 2001' },
  InAs: { gamma: { Eg0: 0.417, alpha: 2.76e-4, beta: 93 }, me: 0.026, mhh: 0.333, epsR: 15.1, a: 6.0583, source: 'VMR 2001' },
  InP: { gamma: { Eg0: 1.4236, alpha: 3.63e-4, beta: 162 }, me: 0.0795, mhh: 0.53, epsR: 12.5, a: 5.8697, source: 'VMR 2001' },
  // Si is indirect; Thurmond, J. Electrochem. Soc. 122, 1133 (1975), doi:10.1149/1.2134410.
  Si: { X: { Eg0: 1.170, alpha: 4.73e-4, beta: 636 }, me: 0.26, mhh: 0.49, epsR: 11.7, a: 5.431, source: 'Thurmond 1975' },
  // Room-temperature bulk values used with the Brus model; literature spread is wide. Verify before quantitative use.
  CdSe: { gamma300: 1.74, me: 0.13, mhh: 0.45, epsR: 10.6, source: 'typical literature values (check)' },
};

export function varshni({ Eg0, alpha, beta }, T) {
  if (!(T >= 0)) throw new Error('Temperature must be ≥ 0 K.');
  return Eg0 - (alpha * T * T) / (T + beta);
}

// Lowest gap of a material at T, and whether it is direct (Γ) or indirect (X).
export function gapAt(name, T = 300) {
  const m = MATERIALS[name];
  if (!m) throw new Error(`Unknown material ${name}.`);
  if (!m.gamma && !m.X) return { Eg: m.gamma300, direct: true, valley: 'Γ' };
  const g = m.gamma ? varshni(m.gamma, T) : Infinity, x = m.X ? varshni(m.X, T) : Infinity;
  return g <= x ? { Eg: g, direct: true, valley: 'Γ' } : { Eg: x, direct: false, valley: 'X' };
}

// ---------- composition (alloys) ----------
// Vegard-style interpolation with bowing: Eg(x) = (1−x)·Eg_A + x·Eg_B − x(1−x)·b(x).
// `x` is the fraction of B. Bowing per valley from VMR 2001.
export const ALLOYS = {
  // In(x)Ga(1−x)As: A = GaAs, B = InAs
  InGaAs: { A: 'GaAs', B: 'InAs', bowing: { gamma: () => 0.477 } },
  // Al(x)Ga(1−x)As: A = GaAs, B = AlAs; Γ bowing depends on x, X nearly linear
  AlGaAs: { A: 'GaAs', B: 'AlAs', bowing: { gamma: (x) => -0.127 + 1.310 * x, X: () => 0.055 } },
};

export function alloyGap(name, x, T = 300) {
  const al = ALLOYS[name];
  if (!al) throw new Error(`Unknown alloy ${name}.`);
  if (!(x >= 0 && x <= 1)) throw new Error('Composition x must be between 0 and 1.');
  const A = MATERIALS[al.A], B = MATERIALS[al.B];
  const valley = (k) => {
    if (!A[k] || !B[k] || !al.bowing[k]) return Infinity;
    return (1 - x) * varshni(A[k], T) + x * varshni(B[k], T) - x * (1 - x) * al.bowing[k](x);
  };
  const g = valley('gamma'), X = valley('X');
  return g <= X ? { Eg: g, direct: true, valley: 'Γ', gammaGap: g, xGap: X } : { Eg: X, direct: false, valley: 'X', gammaGap: g, xGap: X };
}

// Composition that gives a target gap (bisection on a monotonic branch).
export function compositionFor(name, targetEg, T = 300, lo = 0, hi = 1) {
  const f = (x) => alloyGap(name, x, T).gammaGap - targetEg;
  let a = lo, b = hi, fa = f(a);
  if (fa * f(b) > 0) throw new Error(`${name} can’t reach ${targetEg} eV on its direct gap between x = ${lo} and ${hi}.`);
  for (let i = 0; i < 80; i++) { const m = (a + b) / 2, fm = f(m); if (fa * fm <= 0) b = m; else { a = m; fa = fm; } }
  return (a + b) / 2;
}

// ---------- size (quantum confinement) ----------
// Infinite square well of width L: ground electron + ground heavy-hole level.
// Overestimates real wells (finite barriers let the wavefunction leak); use as an upper bound.
export const quantumWellShift = (Lnm, me, mh) => confinementEV(Lnm) * (1 / me + 1 / mh);

// Brus (1984) spherical dot of radius R: confinement − electron–hole Coulomb attraction.
// L. E. Brus, J. Chem. Phys. 80, 4403 (1984), doi:10.1063/1.447218. Known to overestimate
// the gap for small dots (R ≲ 2 nm) because it assumes infinite walls and parabolic bands.
export function brusGap(Rnm, { Eg, me, mh, epsR }) {
  const R = Rnm * 1e-9;
  const confine = confinementEV(Rnm) * (1 / me + 1 / mh);
  const coulomb = (1.786 * Q) / (4 * Math.PI * EPS0 * epsR * R); // in eV (Q²/… divided by Q)
  return Eg + confine - coulomb;
}

// ---------- strain ----------
// Pseudomorphic layer on a substrate: in-plane strain ε∥ = (a_sub − a_layer)/a_layer,
// out-of-plane ε⊥ = −2(C12/C11)ε∥. Hydrostatic gap shift = a_gap·(2ε∥ + ε⊥).
// The shear part (b) splits heavy and light holes; it is not included here.
export function biaxialStrainShift({ aLayer, aSub, deformA, C11, C12 }) {
  const ePar = (aSub - aLayer) / aLayer, ePerp = (-2 * C12 / C11) * ePar;
  return { ePar, ePerp, dEg: deformA * (2 * ePar + ePerp) };
}

// ---------- doping ----------
// Burstein–Moss: degenerate electrons fill the conduction band to k_F, so the optical edge moves
// up by ħ²k_F²/2 · (1/me + 1/mh). Parabolic bands; ignores band-gap renormalization (which
// shrinks the gap and partly cancels this) and non-parabolicity.
export function bursteinMossShift(n_cm3, me, mh) {
  const kF = Math.cbrt(3 * Math.PI ** 2 * n_cm3 * 1e6);
  return ((HBAR * kF) ** 2 / (2 * M0)) * (1 / me + 1 / mh) / Q;
}

// ---------- light in, electrons out ----------
// External photoelectric effect (Einstein): fastest photoelectron energy.
export const photoelectronMaxKE = (photonEV, workFunctionEV) => Math.max(0, photonEV - workFunctionEV);
// From a semiconductor, emission into vacuum needs at least electron affinity + gap.
export const photoemissionThreshold = (affinityEV, EgEV) => affinityEV + EgEV;
// Internal photoeffect: detector cutoff and responsivity R = η qλ/(hc) in A/W.
export const cutoffNm = (EgEV) => wavelengthNm(EgEV);
export const responsivity = (nm, eta = 1, EgEV = 0) => (EgEV && photonEnergyEV(nm) < EgEV ? 0 : (eta * nm) / HC_EV_NM);

// AC (modulated) light: the photocurrent follows the modulation until the detector can't.
// RC limit f_RC = 1/(2πRC); uniform-field transit limit f_T ≈ 0.443/τ_transit;
// combined f_3dB = (f_T⁻² + f_RC⁻²)^(−1/2). Response modelled as one pole at f_3dB.
export function acPhotoresponse(fHz, { R, C, transit = 0 }) {
  const fRC = 1 / (2 * Math.PI * R * C);
  const fT = transit > 0 ? 0.443 / transit : Infinity;
  const f3dB = 1 / Math.sqrt(1 / fT ** 2 + 1 / fRC ** 2);
  const r = fHz / f3dB;
  return { fRC, fT, f3dB, gain: 1 / Math.sqrt(1 + r * r), phaseDeg: (-Math.atan(r) * 180) / Math.PI };
}

// ---------- absorption edge ----------
// Allowed direct transitions: α(E) = A·√(E − Eg)/E above the gap. Indirect: A·(E − Eg)²/E.
export const absorption = (EeV, EgEV, A = 1e4, direct = true) => (EeV <= EgEV ? 0 : (A * (direct ? Math.sqrt(EeV - EgEV) : (EeV - EgEV) ** 2)) / EeV);

// Tauc analysis: fit the straight part of (αE)^(1/r) against E and return its intercept,
// r = 1/2 for direct, 2 for indirect. `points` = [[E_eV, alpha], …] above the edge.
export function taucGap(points, direct = true) {
  const p = 1 / (direct ? 0.5 : 2);
  const xy = points.filter(([, a]) => a > 0).map(([E, a]) => [E, (a * E) ** p]);
  if (xy.length < 2) throw new Error('Need at least two points above the edge.');
  const n = xy.length, sx = xy.reduce((s, [x]) => s + x, 0), sy = xy.reduce((s, [, y]) => s + y, 0);
  const sxx = xy.reduce((s, [x]) => s + x * x, 0), sxy = xy.reduce((s, [x, y]) => s + x * y, 0);
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx), icpt = (sy - slope * sx) / n;
  return -icpt / slope;
}
