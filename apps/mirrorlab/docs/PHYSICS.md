# Optical model specification

## Scope and conventions

The implementation is a deterministic, steady-state, geometrical-optics reference model. Coordinates are a right-handed Cartesian frame in **millimetres**, with a nominal mirror vertex at (0,0,0), incoming unfolded rays toward −Z, and outgoing rays toward +Z. A rendered ray is a static path, not an animation of electromagnetic time evolution.

`radius` is R, `aperture` is the full circular clear diameter, `pitch` and `yaw` are degrees, reflectance is a power fraction, and `pupil` is a diameter. Mirror rotation is Ry(yaw) Rx(pitch). Intersections occur in mirror-local coordinates, and normals are transformed back to world coordinates. The coating is on the concave/front face only.

## Surface intersections

For a ray **p(t) = o + t d**, with unit direction d, retain the nearest positive, front-facing intersection inside the clear aperture.

| Surface | Local equation | Front-facing normal before normalization |
|---|---|---|
| Plane | z = 0 | (0,0,1) |
| Sphere, near cap | x² + y² + (z − R)² = R², with z ≤ R | (−x,−y,R − z) |
| Paraboloid | z = (x² + y²)/(2R) | (−x/R,−y/R,1) |

Both curved surfaces have near-axis focal length f = R/2. The sphere's actual marginal focus differs from that paraxial result. The paraboloid's point at z = R/2 collimates exactly on-axis in geometric optics.

The quadratic solver uses a cancellation-resistant root formulation. Spherical sag is evaluated as r² / (R + √(R² − r²)), avoiding subtraction of nearby values. Physical cap, aperture, positive-distance, and sidedness tests exclude the rest of the mathematical surface. Supported parameter ranges are bounded to a small millimetre-scale bench; numerical tolerances here are not a world-coordinate precision solution.

After a hit, **d′ = d − 2(d·n)n**, where n is normalized. This preserves direction length and reverses its normal component. Reflection is not calculated from the tessellated viewport mesh.

## Birdbath geometry

The ideal splitter passes through B = (0,0,b), with normal (0,1,−1)/√2. Its square side is specified in its own plane. Its second in-plane axis is (0,1,1)/√2.

The nominal unfolded display position (x,y,L) is reflected across that plane to actual position (x,L−b,b+y). Source directions undergo the same reflection. The central folded ray starts at (0,L−b,b), travels toward −Y, reflects toward −Z at the splitter, reflects at the mirror, then transmits along +Z through the splitter to the pupil plane z = `detectorZ`.

`distance` is the unfolded vertex-to-source path length L. It is not simply the vertical source-to-splitter gap. `detectorZ − splitterZ` is the central splitter-to-eye spacing. No physical display occlusion or housing obstruction is traced.

The scalar splitter has Rₛ and Tₛ = 1 − Rₛ, zero thickness, no absorption, and no polarization dependence. Mirror reflectance is ρₘ. The surviving main branch has fraction **Rₛ ρₘ Tₛ**, at most ρₘ/4. Mirror loss is counted as absorption even if a real partially transmitting combiner would route some of it into transmitted light. That simplification must be replaced for see-through or ghost predictions.

Only the prescribed main branch is traced. Other splitter ports are placed in an energy ledger, not intersected with additional surfaces. This is not a general non-sequential optical engine. Missed-aperture power is classified as missed/escaped from the prescribed path; it is not assumed physically absorbed by an invisible housing.

## Sources and normalization

- Point: one ideal, zero-area on-axis emitter.
- Display: a 3 × 3 grid covering `width` × `height`, each field carrying equal normalized power. These are field probes, not a pixel-resolved display or an area-integration rule.
- Parallel beam: a uniform-area disk of radius `beamRadius` with all directions along the nominal optical axis.

Point and display rays are uniform in solid angle within the specified half-angle cone. For sample u = (i + 1/2)/N, cos θ = 1 − u(1 − cos α). Azimuth uses a deterministic golden-angle sequence. This is not Lambertian radiance; no cosine-emission distribution is currently modeled. It samples the chosen cone, not an entire hemisphere.

Each launched ray has normalized power 1/(field count × samples per field). Colors indicate field identity. They do not encode RGB wavelengths: ideal scalar mirrors in this model have no dispersion or wavelength-dependent coating.

## Metrics

For each field, calculate the unit vector in the direction of the sum of its surviving output ray directions. Angular deviations are measured from that field's own mean, using atan2 of the perpendicular and parallel components. The RMS angular deviation is reported in arcminutes. The displayed exit RMS is the root of the mean of per-field squared RMS values. Fields with fewer than two surviving rays make this aggregate undefined rather than artificially perfect.

Exit-bundle RMS is calculated after the final intended surface, before pupil clipping, for rays crossing the forward eye plane. Rays propagating away from that plane are counted in the energy ledger but do not enter the angular metric. It is a collimation metric, not resolution, MTF, or blur for an arbitrary finite-distance target. A single spherical mirror's paraxial image distance is s′ = f s/(s−f); positive is a real image in front of the mirror, negative a virtual image. Infinity is represented by null in the paraxial estimate when s = f.

Pupil power is the fraction of launched normalized power whose main-path rays land inside the pupil circle. It includes splitter, mirror, aperture, and pupil losses. It does not predict nits, total display efficiency, real panel brightness, or perceived contrast.

Pupil RMS uses only the rays reaching the selected pupil and still aggregates separately by field. “Fields reaching eye” means at least one ray arrived for that field, a deliberately weak sampling indicator. The UI calls out fewer than ten pupil samples per field; meeting ten is not itself a convergence proof.

The eyebox map uses a 21 × 21 set of candidate pupil centers over ±12 mm in both directions. Each cell integrates the existing eye-plane hits inside a pupil of the specified diameter. It reports power and field presence. It does not rerun aberration analysis at every eye location or certify a usable viewing box.

## Energy accounting

Normalized launch power is partitioned into captured pupil power, main-branch power outside/away from the pupil, missed intended surfaces, mirror absorption, and unused splitter ports. The categories sum to one within floating-point error. v0.1 does not discard faint rays by roulette or apply a hidden intensity cutoff.

## Sweep semantics

A 13 × 13 grid spans 76%–124% of the current curvature parameter and source path, clipped to valid parameter bounds. All other parameters and source samples remain fixed; bounding may repeat values near a hard limit. Ranking minimizes exit-bundle RMS, not pupil RMS, so clipping away poor rays at the eye cannot directly win the objective.

Candidates need at least 20 surviving forward output rays in every field, at least 3% normalized output power, and a defined angular RMS. These gates are fixed prototype heuristics. The winner is only the best *sampled* design under this scalar metric. There is no local refinement or continuous/global optimality guarantee. Field of view, pupil efficiency, package dimensions, and fabrication limits are not constrained in this first sweep. Larger radii can reduce angular field coverage while improving collimation; inspect that tradeoff in a full optical optimizer before choosing hardware.

Changing parameters cancels an in-progress sweep and invalidates its results. A completed candidate may be applied to the live scene. Before interpreting small improvements, rerun with denser ray sampling. Future optimization must explicitly include measured fields, wavelengths, eye locations, target virtual distance, and physical constraints.

## Not implemented

Refraction, finite glass thickness, Fresnel coatings, wavelength/material dispersion, polarization, diffraction, Gaussian wave propagation, surface roughness/scatter, surface errors, mesh intersection, extended finite pixel areas, physical occluding mounts, arbitrary surface sequences, binocular geometry, and secondary reflected branches. The visible mounts and floor grid are decorative references and do not obstruct the simulation.
