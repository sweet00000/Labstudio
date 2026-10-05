# Mirrorlab → a world-scale engineering workbench

Version 0.1 planning baseline · 4 October 2026 · Alexander Sweet

## Product direction

Build a browser-based, open-source 3D engineering environment with Onshape-style dimensions and constraints, Blender-style scene interaction and eventual node graphs, and numerical solvers that explain and optimize a design. Begin with a mirror-based near-eye optical channel. Expand only after the geometry, units, and numerical results are reproducible.

“Web scale” means many independently permissioned projects and concurrent users, with bounded client downloads and on-demand solver jobs. “World scale” means placing precise local assemblies inside georeferenced, streamed environments. It does **not** mean running one uniform fine-resolution physics grid over Earth. The intended interpretation is a planning assumption that can be revised without rebuilding the optical kernel.

## The working first release

Mirrorlab v0.1 has plane, spherical, and parabolic mirrors, an ideal birdbath path, extended-source field sampling, exact 3D specular reflection, finite apertures, a movable circular pupil, an eyebox map, and a curvature/path sweep. Project parameters are saved as versioned JSON. Renderer meshes and solver surfaces are driven by the same values but do not share an approximation.

This is the seed of the larger system, not a miniature CAD kernel. The project deliberately does not yet include Replicad, Optiland, a node editor, a backend, or global geospatial streaming. The current pure numerical module provides a small independent reference against which future engines can be compared.

## Sequence and completion gates

Effort ranges below are planning estimates for one experienced developer working full time, after access to the relevant test hardware and optical data. They are not delivery promises. Some modules can later be developed concurrently, but their numerical gates remain independent.

| Milestone | User outcome | Main work | Completion gate | Rough effort |
|---|---|---|---|---|
| M0 · mirror bench | Understand and compare one mirror channel | Current app, project format, ray intersections, sweeps, tests | Analytic checks pass; energy closes; desktop/mobile interactions verified | Implemented in this package |
| M1 · optical design | Predict an actual glasses channel | Surface sequence editor, conics/aspheres, refractive solids, measured emission, materials/coatings, wavelength and polarization requirements | Agreement with an independent optical model and a measured bench for a documented prescription | 4–8 weeks |
| M2 · parametric assembly | Design the mounts and frame around the optical channel | CAD adapter, constraints, object transforms, sketch/extrude operations, dimensions, undo/redo, STEP export | A parameter change updates CAD and rays; unit-aware export round trips; collision checks on the housing | 6–12 weeks |
| M3 · simulation workbench | Reuse scans and compare flow/thermal designs | Splat Tunnel import adapter, mesh QA, solver job contracts, node graph, reproducible parameter studies | Known meshes round trip; flow converges on benchmark cases; solver settings/results carry provenance | 8–16 weeks |
| M4 · project service | Share, branch, review, and recompute projects | Auth, permissions, metadata database, blob storage, job queue, signed artifacts, autosave/conflict handling | Deterministic snapshots, cross-account permission tests, recoverable jobs and enforced quotas | 8–16 weeks |
| M5 · world context | Work on local assemblies inside a streamed world | Georeferencing, local frames, level-of-detail streaming, 3D Tiles adapter, spatial metadata, regional simulation domains | Camera transitions maintain local precision; downloads respect budgets; results remain tied to local geometry | 12–24+ weeks |

These are cumulative development stages. A production collaborative world modeler is a sustained project; it is not the current optical demo with a larger coordinate range.

## M1: make the optical predictions useful

Acquire the actual display dimensions, pixel pitch, angular emission distribution, spectral data, mirror prescription and surface errors, splitter thickness and substrate, coating R/T versus wavelength and incidence angle, and pupil/eye-relief requirements. Keep any invented example values visibly identified as examples.

Begin with a generic prescribed sequence of analytic surfaces. Add Snell refraction, total internal reflection, optical path length, conic/aspheric surfaces, and wavelength-dependent material/reflectance evaluation. Follow with bounded secondary-branch tracing, surface sidedness, and detector definitions. Add polarization only with a clear convention and a validation case. A 50/50 scalar splitter cannot represent polarization-selective birdbath components.

Use Optiland as an independent reference or an optional Python solver adapter. Pin a tagged version or a specific commit. Its non-sequential engine's published limitations currently include polarization and visibility gradients; do not make those gaps implicit product promises. The browser module should remain useful without Python.

Metrics should expand from ideal point-field ray spread to angular distortion, image distance/vergence, field-dependent pupil throughput, eyebox uniformity, finite-pixel extent, and tolerancing. MTF, diffraction PSF, and coherent Gaussian-beam propagation require an explicitly appropriate model; do not infer them from geometric spot dots. A microdisplay is an extended, generally incoherent source, not a single Gaussian beam.

Suggested acceptance targets, to be agreed for each real design: no unexplained lost power above 10⁻⁸ in deterministic scalar tests; sub-micrometre agreement on analytic intersections over a documented millimetre-scale domain; angular and flux agreement with an independent engine inside separately specified tolerances; converged sampling; measured spot/angle data within an experimentally justified error budget. These are proposed gates, not certifications achieved by v0.1.

## M2: geometry that can be manufactured

Use a Replicad/OpenCascade.js adapter for boundary-representation solids and STEP workflows. Keep the kernel behind an interface so the app's scene and parameter models do not depend on a particular renderer or CAD library. Review and preserve each dependency's license obligations before distribution.

One parameter model should drive three representations: exact surface/CAD parameters, the solver geometry, and a cached tessellation for display. The display mesh is disposable; it is not the authoritative radius, aperture, or refractive interface. Assign stable object and surface identifiers early. When a CAD operation changes topology, fail a broken constraint visibly instead of silently attaching it to a different face.

Initial assembly deliverable: one display, splitter mount, curved mirror mount, adjustable pupil/eye-relief reference, and printable housing. Then duplicate the optical channel for binocular alignment, interpupillary adjustment, and frame geometry. Add a node graph only after there is a command/parameter system for it to edit.

## M3: scan and flow modules

The uploaded Splat Tunnel project already contains useful separation between loaders, voxelization, meshing, export, WebGPU flow, and optional cloud jobs. Preserve it as a reference and adapt one boundary at a time. Its simulation and accuracy claims have not been independently validated by the Mirrorlab tests.

First import geometry with explicit units, axis conventions, measured scale, and provenance. Mark Gaussian splats as appearance observations: they are not automatically watertight solids, accurate optical surfaces, or a volume mesh. Preserve the raw scan alongside a cleaned derivative and its uncertainty. Validate the mesh before any CFD, thermal, or fabrication use.

Second add a flow job adapter with explicit geometry hash, fluid properties, length scale, boundary conditions, Reynolds number, mesh resolution, numerical method, convergence history, and force normalization. Separate steady-state residual criteria from merely running a fixed number of steps. Grid refinement and an independently checked benchmark must gate promotion from qualitative preview to quantitative claims. See [SPLATTUNNEL.md](docs/SPLATTUNNEL.md).

Couple optical and thermal models initially through weak, explicit one-way exchanges: a temperature field changes material properties, mirror deformation changes surface geometry. Tight multiphysics coupling requires stable units, interpolation, conservation checks, and a separately validated iteration scheme.

## M4: web-scale operation

Store small project metadata, membership, and version indexes in a relational database. Store scans, meshes, textures, and solver outputs as immutable, content-addressed objects. A project snapshot refers to those objects by hashes; it does not embed gigabytes in JSON or in a database row.

Run local computations first. Route heavier cases to an asynchronous job service only after an explicit user action and cost/quota check. A job records the exact project snapshot, solver build, parameters, sampling seed, resource limits, and output schema. Support cancellation, timeout, checkpoints, idempotency, and deduplication. A browser disconnect must not accidentally launch or duplicate an expensive simulation.

Start collaboration with optimistic version checks and visible conflicts. Add real-time presence and mergeable annotations next. Introduce collaborative parametric edits only with a command dependency model: concurrent extrusion and deletion are not resolved safely by last-write-wins on JSON. Server-side project authorization must cover every artifact and job route, not just the project list.

Measure usage before choosing sharding or a multi-region architecture. Proposed service gates: bounded per-project storage and worker resource use, recovery after a worker kill, no cross-project data exposure, immutable-result reproduction, and a load test representative of actual scene sizes and concurrent jobs.

## M5: a world that preserves engineering precision

Use geospatial coordinates to locate assemblies, and local right-handed Cartesian frames to engineer them. Each engineering region has an origin, orientation, units, coordinate reference system, vertical datum, and revisioned placement transform. CPU calculations use local Float64 values. Rendering uses camera-relative coordinates or an equivalent high/low representation so GPU float precision does not turn millimetres into metres near Earth-sized coordinates.

Use OGC 3D Tiles for streamed environmental context, with glTF-based visual assets and explicit metadata. Keep STEP/B-rep sources for manufacturable solids and analytical prescriptions for optics. No one file format needs to carry every representation. Appearance splats, render meshes, solids, and physics meshes remain distinct assets linked to the same object identity.

A region's physics grid or ray scene should cover its problem domain, boundary conditions, and interactions. Faraway terrain is usually visual context. Environmental heat, wind, or illumination inputs can cross domain boundaries through documented interface conditions; arbitrary visual tile boundaries must not become unphysical solver boundaries.

Proposed performance experiments: stream a synthetic million-object scene using spatial hierarchy and instancing; load only the current view's LOD; keep cold-start downloads within a declared budget; cap client memory and GPU resources; maintain under 1 mm local placement error after round trips through georeferenced transforms. Test desktop and midrange mobile hardware separately. These are test targets, not claims that v0.1 can meet them.

## Decisions to preserve across every milestone

1. **Units and reference frames are data.** Convert at module boundaries and serialize the conversion.
2. **Geometry is authoritative; meshes are derived.** An imported mesh may itself be authoritative when no exact source exists, but its uncertainty remains explicit.
3. **Parameters, solver configuration, and results are independently versioned.** A beautiful viewport cannot stand in for a converged numerical result.
4. **Local numerical baselines stay available.** Accelerated engines must pass the same physical tests before replacing the reference implementation.
5. **No single monolithic world solver.** Stream context and solve bounded regions at the resolution their questions require.
6. **Acceptance gates lead expansion.** Add a new physics domain after the preceding domain is reproducible and testable.

## Next three implementation tasks

1. Add a versioned, generic analytic-surface sequence and object transforms. Preserve the four current presets as regression fixtures.
2. Build one independent optical reference case and one physical mirror bench measurement. Compare ray direction, pupil power, and image distance with units and uncertainty recorded.
3. Add a minimal CAD mount driven by the mirror radius/aperture and serialize it in the same project snapshot. Verify that the optical surface is unchanged by display tessellation density.

The detailed issue queue is in [docs/BACKLOG.md](docs/BACKLOG.md). Primary documentation for proposed dependencies and standards is in [docs/SOURCES.md](docs/SOURCES.md).
