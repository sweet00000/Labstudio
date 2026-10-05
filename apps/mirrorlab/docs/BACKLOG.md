# Prioritized implementation backlog

These are ready-to-convert issue descriptions. They are not issues already opened on GitHub.

| ID | Priority | Deliverable | Definition of done | Depends on |
|---|---|---|---|---|
| OPT-001 | P0 | Generic analytic-surface sequence | Multiple explicit surfaces, rigid transforms, sidedness, and detector; all existing preset fixtures still pass | v0.1 |
| OPT-002 | P0 | Reference optical comparison | Reproducible prescription checked in a pinned independent solver; positions, directions, and power compared with stated tolerances | OPT-001 |
| OPT-003 | P0 | Physical mirror bench | Source/mirror/detector dimensions and calibration recorded; measured focus/angles with uncertainty; comparison report | Actual hardware |
| OPT-004 | P0 | Refractive interface and medium tracking | Snell law, TIR, normal-incidence transmission tests, slabs, sign conventions; power closure | OPT-001 |
| OPT-005 | P0 | Prescribed surface data import | Radii, conics, thicknesses, apertures, material IDs, coatings, transforms, units; validation errors block a run | OPT-001 |
| OPT-006 | P1 | Real emitter and spectral model | Measured or documented angular/spectral distributions; finite pixel extents; normalization independently verified | OPT-002 |
| OPT-007 | P1 | Wavelength/angle coating tables | Interpolation domain and uncertainty explicit; energy and spectral fixture tests | OPT-004, OPT-006 |
| OPT-008 | P1 | Polarization and branch paths | Defined Jones/Stokes convention where appropriate; polarization splitter reference; bounded ghost tracing with diagnostics | OPT-007 |
| OPT-009 | P1 | Optical multiobjective study | Target vergence, FOV, pupil efficiency, blur, package constraints; infeasible reasons; common sampling and refinement | OPT-002, OPT-006 |
| OPT-010 | P1 | Tolerance study | Seeded distributions, sensitivity, yield criteria, reproducible sample set and results | OPT-009 |
| CAD-001 | P0 | Versioned project/command core | Stable IDs, units, dependency invalidation, undo/redo, migration from current JSON | v0.1 |
| CAD-002 | P1 | CAD-kernel adapter | Mirror mount and housing driven by shared optical dimensions; valid STEP export | CAD-001 |
| CAD-003 | P1 | Picking and transform interaction | Select/move/rotate components in 3D with snapping; changes go through commands, not mesh-only edits | CAD-001, OPT-001 |
| CAD-004 | P1 | Constraints and assembly dimensions | Explicit references, broken-reference diagnostics, no silent reassignment after topology change | CAD-002 |
| CAD-005 | P2 | Node editor | Typed parameter/geometry/study/result ports; unit checks; deterministic regeneration | CAD-001, CAD-004 |
| DATA-001 | P1 | Splat Tunnel loader adapter | Golden STL/OBJ/GLB/PLY fixtures; known dimensions/axes and retained source metadata | CAD-001 |
| DATA-002 | P1 | Mesh repair and uncertainty | Watertightness/nonmanifold reports, explicit scale, separation of raw and cleaned derivatives | DATA-001 |
| FLOW-001 | P1 | Validated flow module | Reynolds number, BCs, force normalization, residuals, resolution sweep, independent benchmark comparison | DATA-002 |
| FLOW-002 | P2 | Optional remote solver jobs | Container pinning, cost/resource quotas, cancellation, artifacts, rerun provenance | FLOW-001, WEB-002 |
| WEB-001 | P1 | Shared immutable project snapshots | Auth, ACLs, version check, metadata/blob split, cross-account tests | CAD-001 |
| WEB-002 | P1 | Asynchronous solver service | Typed job state transitions, idempotency, cancellation, resource limits, checkpoint/recovery | WEB-001 |
| WEB-003 | P2 | Collaborative commands | Presence, annotations, explicit conflict resolution for dependent CAD operations | WEB-001, CAD-004 |
| WORLD-001 | P1 | Georeferenced local frames | CRS/datum/unit metadata, Float64 local transforms, mm-level round-trip fixture near Earth scale | CAD-001 |
| WORLD-002 | P2 | Streamed environmental context | 3D Tiles/glTF adapter, screen-error LOD, request cancellation, bounded cache/GPU memory | WORLD-001 |
| WORLD-003 | P2 | Bounded simulation regions | Visual LOD independent of physics mesh; conservative boundary-data exchange documented | WORLD-002, FLOW-001 |
| WORLD-004 | P2 | Scale/load benchmark suite | Synthetic large scene; download/memory/frame-time metrics on real mobile and desktop; multitenant server load test | WEB-002, WORLD-002 |

For any issue that changes physics, include the governing assumptions, input units, expected invariants, an independent fixture, and a tolerance with a reason. For UI-only changes, use the existing browser smoke test or manual visual check; avoid tests that merely repeat markup.
