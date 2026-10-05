# Validation report and reproduction

## What was actually run

The delivered version was checked with **20 deterministic Node.js tests**, a Chromium browser integration test with software WebGL, and visual inspection of desktop and narrow-screen screenshots. Tests ran under Node.js 24.19.0. Browser automation used Playwright 1.51.1 with Chromium 133 from a packaged headless binary in the build environment. This verifies the tested configuration, not every browser, hardware GPU, mobile device, or optical design.

All 20 numerical tests passed. The browser test verified WebGL initialization, parameter updates changing the computed result, the parabolic/flat/birdbath presets, the eyebox interaction, camera and normal controls, the 169-candidate sweep, applying its winner, JSON round-trip export/import, invalid-schema rejection, sweep CSV export, the guide dialog, desktop/narrow layouts, and zero external runtime requests. No page script errors were observed.

## Physical checks

| Check | Acceptance used |
|---|---|
| Reflection law | Unit length retained; normal component reversed; tangential component unchanged |
| Root conditioning | Both roots retained in a cancellation-sensitive quadratic; linear axial case handled |
| Rotated geometry | Orthonormal transforms; analytical intersection and normal preserved under rotation |
| Sphere boundaries | Near cap retained; outside-aperture and back-face intersections rejected |
| Plane tilt | 8° mirror tilt yields 16° ray deflection |
| Parabolic collimation | Rays from z = R/2 reflect toward +Z, component error below 10⁻¹² |
| Parabolic focusing | Parallel rays across aperture meet at R/2 to 10⁻⁹ mm |
| Spherical aberration | Near-axis focus tends to R/2; marginal rays focus earlier |
| Folded birdbath | Central path visits all intended surfaces; surviving fraction is 0.5 × 0.92 × 0.5 |
| Finite splitter | Out-of-bounds intersections rejected on both in-plane axes |
| Source quadrature | Mean cosine matches uniform-solid-angle cone analytically |
| Energy ledger | Fractions sum to one within 10⁻¹¹ for clipping, tilts, zero reflectance, and splitter endpoints |
| Per-field metrics | Field directions differ while within-field RMS remains independently calculated |
| Pupil/map normalization | Center map cell, field average, and integrated pupil ledger agree |
| Paraxial conventions | Real, virtual, infinite, and parallel-input cases have explicit behavior |
| Sweep objective | Parabolic focal geometry beats defocus; zero-light candidates rejected |
| Project format | Round trip; bad types, units/version, geometry, samples, and enums rejected |

These are analytical invariants and known physical cases. They are not a comparison to an independent full optical package or hardware measurements. Those are required in M1.

## Default birdbath sampling check

This checks integration sensitivity with unchanged geometry, not model fidelity to a physical display.

| Rays per field | Total rays | Exit RMS (arcmin) | Pupil fraction of launch | Fewest pupil hits in a field | Energy residual |
|---:|---:|---:|---:|---:|---:|
| 256 | 2,304 | 12.50979 | 0.00319444 | 3 | 8.22 × 10⁻¹⁵ |
| 1,024 | 9,216 | 12.48802 | 0.00331923 | 14 | 3.33 × 10⁻¹⁴ |
| 4,096 | 36,864 | 12.51675 | 0.00332547 | 56 | 1.83 × 10⁻¹³ |

Between the standard and fine samples, exit RMS changes by about 0.23% and pupil fraction by about 0.19%. The coarse pupil estimate is visibly less stable and has too few samples for reliable eye-quality comparisons. These data do not establish a universal convergence threshold; moving or shrinking a pupil can require more samples. A low energy residual tests accounting, not ray-density accuracy.

On this execution environment, the three runs including the eyebox map took approximately 37, 56, and 192 ms. These are single-run measurements with JIT and host effects, not browser or user-hardware performance guarantees.

## Run the checks

```sh
npm test
npm run benchmark
npm run build
```

For the optional browser test, install the pinned test runner (the app itself has no package dependencies):

```sh
npm install --no-save --package-lock=false playwright@1.51.1
npx playwright install chromium
npm run test:browser
```

On Linux, Playwright may require its documented system browser dependencies. The integration test starts and stops its own local server on port 5183 and writes screenshots and exported test artifacts to `test-results/`. It serves the app under `/web/`, exercising relative asset URLs for project-path hosting.

For an existing compatible Chromium executable, set `MIRRORLAB_CHROMIUM_EXECUTABLE`. For a separately installed Playwright module, set `MIRRORLAB_PLAYWRIGHT_MODULE` to its absolute ESM entry point. These are test-only options. The default public CI gate runs numerical tests and builds static output; the browser integration test is optional and has a separate manual workflow.

## Remaining validation before engineering use

1. Match a complete optical prescription in an independent engine, with signed radii, transforms, media, coatings, and detector conventions documented.
2. Compare bench-measured ray angles/focus and pupil throughput with calibrated source and sensor uncertainty.
3. Add wavelength/material and polarization cases before claiming chromatic or polarization predictions.
4. Add finite-pixel, distortion, vergence, and image-quality criteria before claiming readable display performance.
5. Test real desktop and mobile devices, context loss/restoration, input accessibility, and sustained large-study memory usage before a wider release.
