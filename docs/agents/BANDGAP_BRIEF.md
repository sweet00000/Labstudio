# Agent brief: a tunable band-gap workspace

Hand this file to a coding agent (Claude Code or similar) working in this repository. It says what to build, how to research it, how to prove it works, and where it fits.

## Mission

Add a **Materials** workspace to LabStudio that shows how a semiconductor's band gap can be tuned (by composition, temperature, size, strain, doping) and what that does to light: the emission or cutoff wavelength, photodetector responsivity, and how a photodetector responds to modulated (AC) light.

**Done means all of these hold:**

1. `node tools/agent/drive.mjs tools/agent/scenarios/materials-bandgap.json` prints `PASSED`. It fails today on purpose.
2. `npm test` passes, including new tests for any physics you add.
3. Every material parameter in code has a source comment (a DOI, or "unverified" with a reason), and `research/bandgap/sources.md` lists what you read.
4. The workspace states each model's limits in the UI (`#modelLimits`). A number without its validity range is a bug.
5. The existing scenario `tools/agent/scenarios/studio-smoke.json` still passes.

## Start here

```sh
npm test                                                     # 41 tests: CAD, optics, band-gap kernel, research helpers
npm install && npx playwright install chromium               # once: browser driver dependencies
node tools/agent/drive.mjs tools/agent/scenarios/studio-smoke.json   # should pass
node tools/agent/drive.mjs tools/agent/scenarios/materials-bandgap.json  # fails: "no tab materials"
node tools/agent/drive.mjs --map                              # every button/input on the studio page, with selectors
```

Read `AGENTS.md`, then `packages/physics/bandgap.js`. It is a tested reference kernel with the equations below. **Extend it; don't fork it.**

## Where things go

| Piece | Path | Pattern to copy |
|---|---|---|
| Physics (pure functions, no DOM) | `packages/physics/bandgap.js` | `apps/mirrorlab/web/src/physics.js` |
| Physics tests | `packages/physics/tests/*.test.mjs` | `packages/physics/tests/bandgap.test.mjs` |
| The workspace page | `apps/materials/web/index.html`, `style.css`, `src/main.js` | `apps/mirrorlab/web/` (standalone page, hosted in a studio tab) |
| Tab in the studio | `apps/studio/web/index.html` (a `data-tab="materials"` button and a `#tab-materials` section) and `FRAMES` in `apps/studio/web/src/main.js` | the `optics` tab |
| Site build | add `apps/materials/web` to the list in `scripts/build.mjs` | |
| Sources | `research/bandgap/` via `tools/research/openalex.mjs plan tools/research/plans/bandgap.json` | |

Conventions: ES modules, no build step, no runtime CDN, relative imports (`../../../../packages/physics/bandgap.js`). Units: eV, nm, K, cm⁻³ at the UI; SI inside. Light and dark themes via CSS custom properties, as in the studio. Works at 390 px wide.

## UI contract (what the acceptance scenario drives)

`window.materials = { state, result }`, updated synchronously after every input `change`:

- `state`: `{ system, x, T, sizeNm, strain, n_cm3 }`, where `system` ∈ `"InGaAs" | "AlGaAs" | "CdSe-dot"` (add more freely).
- `result`: `{ Eg, direct, valley, wavelengthNm, responsivity, ac: { fRC, fT, f3dB, gain, phaseDeg } }`.

Element ids: `#system` (select), `#composition`, `#temperature`, `#sizeNm`, `#targetNm` and `#solveComposition` (inverse design), `#gapKind` (text containing "direct" or "indirect"), `#modelLimits` (text), `#modHz`, `#loadOhm`, `#capPf`, `#transitPs` (AC panel), and optionally `#exportCsv`.

Defaults: **In₀.₅₃Ga₀.₄₇As at 300 K** (lattice-matched to InP, gap ≈ 0.74–0.75 eV, cutoff ≈ 1.65 µm). Show a plot of Eg against the active variable (x, T or size), with the current point marked and the direct/indirect crossover drawn where there is one.

## The physics (what the kernel already implements)

| Knob | Model | Equation | Valid when | Check |
|---|---|---|---|---|
| Temperature | Varshni | E_g(T) = E_g(0) − αT²/(T + β) | crystalline semiconductors, roughly 4 K to 600 K | GaAs 1.424 eV, Si 1.12 eV at 300 K |
| Composition | Vegard + bowing | E_g(x) = (1−x)E_A + xE_B − x(1−x)·b(x), per valley (Γ, X, L) | random alloys; b from experiment or first principles | In₀.₅₃Ga₀.₄₇As ≈ 0.745 eV; AlGaAs turns indirect near x ≈ 0.43 |
| Size, well | infinite square well | ΔE = (ħ²π²/2L²)(1/m_e + 1/m_h) | upper bound; real (finite) barriers give less | scales as 1/L² |
| Size, dot | Brus (1984) | E = E_g + (ħ²π²/2R²)(1/m_e + 1/m_h) − 1.786e²/(4πε₀ε_rR) | R ≳ exciton Bohr radius; **overestimates small dots** | → bulk as R → ∞ |
| Strain | deformation potential | ΔE_g = a(ε_xx + ε_yy + ε_zz), with biaxial ε⊥ = −2(C₁₂/C₁₁)ε∥ | small strain, below critical thickness; shear term b splits HH/LH (not yet included) | compressive + a < 0 opens the gap |
| Doping | Burstein–Moss | ΔE = (ħ²/2)(3π²n)^{2/3}(1/m_e + 1/m_h) | degenerate n; ignores gap renormalization (opposite sign) and nonparabolicity | scales as n^{2/3} |
| Light → electrons (external) | Einstein | KE_max = hν − φ | metals; from semiconductors the threshold is χ + E_g | |
| Light → current (internal) | responsivity | R = η·qλ/(hc) = η·λ[nm]/1239.84 A/W, zero above λ_c = 1239.84/E_g | | 1 A/W at 1239.84 nm with η = 1 |
| AC light | RC + transit | f_RC = 1/(2πRC), f_T ≈ 0.443/τ_tr, f_3dB = (f_T⁻² + f_RC⁻²)^(−1/2) | one-pole approximation | 50 Ω, 1 pF → 3.18 GHz |
| Absorption edge | Tauc | α ∝ √(E−E_g)/E (direct), (E−E_g)²/E (indirect); E_g from the straight part of (αE)² or (αE)^{1/2} | above the Urbach tail | recovers E_g from synthetic data |

### Worth adding (each needs a source and a test)

1. **Urbach tail** below the gap: α = α₀ exp((E − E_g)/E_U).
2. **Band-gap renormalization** with doping, to offset Burstein–Moss: ΔE ∝ −n^{1/3}.
3. **Finite-barrier quantum well** (solve the transcendental equation), to replace the infinite-well upper bound.
4. **Quantum-confined Stark effect**: field-tuned well transitions (Miller et al. 1984).
5. **Detailed-balance (Shockley–Queisser) efficiency against E_g**: blackbody sun first, then the AM1.5G table. Target: about 33.7% at about 1.34 eV for AM1.5G.
6. **More systems**: mixed-halide perovskites, MAPb(I₁₋ₓBrₓ)₃ (~1.6 → 2.3 eV); monolayer vs bulk MoS₂ (direct ~1.8–1.9 eV vs indirect ~1.2–1.3 eV); bilayer graphene under a displacement field (0 → ~0.25 eV).

## How to research

OpenAlex is the scholarly index (about 250 M works). The tool is `tools/research/openalex.mjs`.

1. Get a free API key at https://openalex.org/settings/api; keys are required since February 2026. Then `export OPENALEX_API_KEY=...`. Lookups by DOI are free; searches cost a tiny amount against the daily allowance.
2. If `api.openalex.org` is unreachable, the sandbox's network allowlist blocks it. Ask the user to allow that host. Don't work around it.
3. Run the plan: `node tools/research/openalex.mjs plan tools/research/plans/bandgap.json`. It looks up the classic papers by DOI (Varshni, Vurgaftman–Meyer–Ram-Mohan, Brus, Burstein, Tauc, Urbach, Shockley–Queisser, Einstein, …), runs topic searches, and writes `research/bandgap/sources.md` with reconstructed abstracts. The DOIs in the plan were written from memory: if one resolves to the wrong paper, fix the plan.
4. Expand from a seminal paper: `citing W… --sort=cited` finds the follow-ups people use; `search "..." --type=review --from=2020` finds recent reviews.
5. **Numbers come from tables, not abstracts.** Open the paper (the `open access` link when there is one) and copy parameters with their table number. If you can't reach the full text, mark the value `unverified` in the code and say so in the UI.

## How to test in the browser

`tools/agent/drive.mjs` runs a JSON scenario in Chromium against the repo's dev server and writes `test-results/agent/<name>/report.json` plus screenshots. Work in this loop:

1. `--map` (or a `{"do":"map"}` step) to see what's clickable.
2. Write or extend steps; `"frame": "materials"` acts inside the workspace's iframe.
3. Run, read `report.json` (failing step, error, page errors), and look at the `fail-step-N.png` screenshot.
4. Fix and rerun. Add `"soft": true` only to steps that are optional.

Use `{"do":"expect","js":"…","approx":x,"tol":r}` for physics values (relative tolerance) and `expectText` for what a person reads. Never assert pixel colours.

## How it connects to the rest of LabStudio

These follow the repo's rule of explicit, one-way couplings (`apps/mirrorlab/PROJECT_PLAN.md`):

- **Materials → Optics.** The birdbath display's emission is set by its emitter's gap: wavelength 1239.84/E_g, with the Urbach/thermal linewidth. This becomes Mirrorlab backlog item OPT-006 (real emitter and spectral model).
- **Wind tunnel → Materials.** Airflow sets the junction temperature, temperature shifts E_g (Varshni), and E_g shifts the LED wavelength: about +0.3 nm/K for GaAs near 870 nm.
- **Materials → Model (CAD).** A detector at the eye pupil gets a responsivity and an AC bandwidth; a heat sink for the emitter is a CAD part you can send to the wind tunnel.

## Out of scope

No DFT or band-structure solver, and no device (drift-diffusion) simulation. If the work needs one, say so, recommend a tool, and stop. Everything here is a parabolic-band, textbook-level model, and the UI must say that.
