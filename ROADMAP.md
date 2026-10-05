# LabStudio roadmap

Status as of **5 October 2026** · Alexander Sweet

## Where things stand

Two working apps, side by side, sharing nothing yet.

| | Mirrorlab | Splat Tunnel |
|---|---|---|
| Physics | Geometric optics, specular reflection, Float64 CPU in a Web Worker | D3Q19 LBM + Smagorinsky LES, WebGPU compute, f16 storage |
| Geometry | Analytic surfaces (exact) | Scans / meshes → voxels → watertight mesh |
| Renderer | Three.js r180, WebGL 2 | Hand-written WebGPU |
| Project file | Versioned JSON, mm and degrees | None (session only) |
| CAD | None | Mesh export only (STL, 3MF, GLB, OBJ, PLY, VTK) |
| Backend | None | Optional AWS: OpenFOAM + photo-to-splat jobs behind a budget cap |
| Tests in CI | 20 physics tests + static build | Mesher/exporter round trips + API Lambda (GPU solver tests need a GPU, run locally) |

Not started: CAD kernel, general fluid mechanics beyond the wind tunnel, OpenMC / particle transport, a shared shell app, accounts.

Mirrorlab's own deeper plan (M0–M5) and issue-sized backlog are in [`apps/mirrorlab/PROJECT_PLAN.md`](apps/mirrorlab/PROJECT_PLAN.md) and [`apps/mirrorlab/docs/BACKLOG.md`](apps/mirrorlab/docs/BACKLOG.md). This file sequences the whole studio and reuses those IDs.

## The one idea that holds it together

Every module reads the same **project snapshot**: objects with stable IDs, units, transforms, and an authoritative geometry source (analytic surface, CAD solid, or scan). Each solver derives its own representation from that: rays need exact surfaces, the LBM needs voxels, OpenFOAM needs a surface mesh, OpenMC needs CSG or a DAGMC mesh. Solvers never edit geometry; they return results tied to a geometry hash.

Build that spine first. Without it, every new simulator is another island.

## Phases

| # | Phase | Delivers | Done when | Backlog IDs |
|---|---|---|---|---|
| 0 | Monorepo | Both apps in one repo, one CI, one Pages site | CI green on `main`; hub page live | (this commit) |
| 1 | Shared core | `packages/core`: project snapshot schema with units and frames, migration from Mirrorlab v1 JSON, solver job contract | Mirrorlab's four example projects migrate and still pass every test | CAD-001 |
| 2 | Shared geometry I/O | `packages/geometry`: Splat Tunnel's loaders, mesher and exporters moved out of the app, used by both | Golden cube/sphere fixtures round-trip with known size, axes and units | DATA-001, DATA-002 |
| 3 | Studio shell | `apps/studio`: one page, one Three.js viewport (WebGPURenderer with WebGL fallback), module panels for optics and wind tunnel | Load one project, view it, run a trace and a tunnel run without leaving the page | CAD-003 |
| 4 | CAD | Replicad / OpenCascade.js in a worker: sketch, extrude, fillet, booleans, STEP import/export | A parametric mirror mount regenerates from the mirror radius and drops straight into the wind tunnel | CAD-002, CAD-004 |
| 5 | Ray tracing v2 | Surface sequences, refraction, TIR, conics/aspheres, prescription import | Matches an independent solver (Optiland) on one documented prescription | OPT-001 → OPT-005 |
| 6 | Fluid mechanics | Generalize the LBM beyond the tunnel: channels, internal flow, 2D mode; validation suite (Poiseuille, lid-driven cavity, cylinder Re 100 Strouhal) | Each benchmark within a stated tolerance, run in CI on a software GPU | FLOW-001 |
| 7 | Generic job service | Turn Splat Tunnel's AWS stack into a job runner any module can use (one queue, typed jobs, cancel, provenance) | OpenFOAM job goes through the generic API; budget guard still enforced | WEB-002, FLOW-002 |
| 8 | OpenMC | `openmc` container job: geometry from CAD as DAGMC (or CSG), materials, k-eff and mesh tallies back as VTK, plotted in the studio | Godiva (bare HEU sphere) k-eff within ~0.5% of 1.0 | new: NUC-001 |
| 9 | Collaboration and world scale | Accounts, shared snapshots, georeferenced frames | Per Mirrorlab M4–M5 gates | WEB-001, WORLD-* |

Phases 5 and 6 can run in parallel once 1–3 exist. OpenMC comes after the job service because it does not run in a browser; it is a Python/C++ code that belongs in a container next to OpenFOAM.

## Next three tasks

1. **Project snapshot schema** (`packages/core`). Units, frames, object IDs, asset references, the `SolverRequest`/`SolverResult` types already sketched in `apps/mirrorlab/docs/ARCHITECTURE.md`. Write the Mirrorlab v1 → v2 migration and keep the four example projects as fixtures.
2. **Lift Splat Tunnel's geometry modules** (`loaders.js`, `mesher.js`, `export.js`, `voxelize.js`) into `packages/geometry` with no app globals, plus golden fixtures. Splat Tunnel imports them back; its export test must still pass.
3. **Studio shell skeleton**. One page, one viewport, a module switcher, loading a project snapshot. Mirrorlab's physics worker plugs in first because it has no renderer dependency.

## Decisions to make

- **License.** The repo root is GPL-3.0; both apps are MIT. Mixing is legal (MIT code can live in a GPL project) but confusing. OpenMC is MIT, OpenCascade is LGPL-2.1, OpenFOAM is GPL-3.0 but only runs inside your own container, so none of them forces GPL on the web code. Pick one license for the whole repo.
- **Renderer.** Recommend Three.js everywhere (it has a WebGPU renderer now) and keeping Splat Tunnel's raw WebGPU only for the solver and field visualization.
- **"MCMP".** If this means multi-component multiphase LBM (Shan–Chen) rather than OpenMC, it belongs in phase 6 as an extension of `lbm.js`, not in phase 8.
