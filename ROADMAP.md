# LabStudio roadmap

Status as of **5 October 2026** · Alexander Sweet

## The goal

One browser studio where a physical object goes **scan → CAD → model → print or analysis** without leaving the page. Analysis currently means optics ray tracing and the wind tunnel; fluid mechanics, structures and Monte Carlo particle transport (OpenMC) come later. Every workspace reads the same geometry in millimetres, Z up, and every solver gets its own form of it: rays use exact surfaces, the wind tunnel uses voxels, OpenFOAM uses a surface mesh, and OpenMC will use CSG or a DAGMC mesh.

## Where each stage stands

| Stage | Works today | Missing |
|---|---|---|
| **Capture** | Import `.ply` (Gaussian splats, meshes, points), `.splat`, `.stl`, `.obj`, `.glb`. Photos/video → splats as an optional AWS job in Splat Tunnel | Capture flow inside the studio; scale from a known distance |
| **Scan → solid** | Closed meshes kept exactly; open meshes, splats and points rebuilt as a closed solid on a voxel grid; units and up axis chosen at import | Crop box, pick-the-floor alignment, two-point scale calibration, recording the reconstruction's uncertainty |
| **Model (CAD)** | Feature list on the Manifold kernel: box, cylinder/cone, sphere, imported mesh; add / cut / intersect; position and rotation; part vs reference roles; undo/redo; autosave; project files | Click-to-select and drag handles in the viewport, sketch → extrude/revolve, named parameters, mirror and pattern, measuring, section view, fillets and STEP (needs a B-rep kernel) |
| **Print** | STL, 3MF (mm), OBJ, GLB; placed on the bed; volume and mass by material | Build-volume fit, minimum wall thickness, overhang map, orientation suggestion, hand-off to a slicer |
| **Optics** | Mirrorlab birdbath by default; housing in CAD rebuilt from the current optics design | Ray tracing against the housing (vignetting), refraction and general surfaces (Mirrorlab OPT-001 → OPT-005) |
| **Wind tunnel** | Hatchback by default; any CAD part sent in with one click | Drag/lift and surface pressure coming back into the Model tab; sweeps over a parameter |
| **Other physics** | (none) | Fluid mechanics beyond the tunnel, structural/thermal FEA, OpenMC |

## What's next, in order

Each step leaves the studio usable and adds one complete capability.

1. **Pick and place in the viewport.** Click a body to select its feature; drag handles to move and rotate; snap to the grid and to faces. This is the biggest usability gap right now.
2. **Sketch → extrude / revolve.** 2D polygon and circle sketches on a plane, extruded or revolved (Manifold's `CrossSection`), so the studio can model brackets and mounts, not just boxes.
3. **Named parameters.** `wall = 3`, `mirror_d = optics.aperture`; features reference them, and the birdbath template becomes formulas instead of numbers baked in at generation time.
4. **Scan clean-up.** Crop box, floor alignment, two-point scale calibration. Together with steps 1 and 2 this completes scan → CAD → print for a real object (for example a mount fitted to a scanned part).
5. **Printability report.** Fits the build volume, thinnest wall, overhangs over 45°, estimated print mass and time per material.
6. **Results back into the model.** The wind tunnel sends drag, lift and a per-face pressure map back; the Model tab colours the part with it. Optics traces the housing as an obstruction.
7. **One project file.** CAD features, optics parameters and solver settings and results in one `labstudio.project`, replacing today's separate saves.
8. **B-rep kernel next to Manifold.** Replicad / OpenCascade.js in a worker, for fillets, chamfers, exact cylinders and STEP in/out. Manifold stays for scans and mesh booleans; parts move between the two as meshes.
9. **Generic cloud job service.** Turn Splat Tunnel's AWS stack into one queue any workspace can use (OpenFOAM first), with the budget cap kept.
10. **New physics, each behind a benchmark:** general LBM flow (Poiseuille, lid-driven cavity, cylinder at Re 100), structural FEA, and OpenMC as a container job (Godiva k-eff within about 0.5% of 1.0).

## Decisions made

- **License:** GPL-3.0-or-later for the whole repository. Bundled Three.js (MIT) and Manifold (Apache-2.0) are compatible. OpenCascade (LGPL-2.1), OpenMC (MIT) and OpenFOAM (GPL-3.0) are all compatible too.
- **Workspace convention:** millimetres, Z up, right-handed. Mirrorlab's optics frame (Y up, optical axis +Z) maps to it as (x, y, z) → (x, −z, y).
- **CAD kernel:** Manifold first, because scans are meshes and its booleans stay watertight. A B-rep kernel joins later for precise parametric parts (step 8).
- **Integration:** each app still runs on its own; the studio hosts Optics and Wind tunnel in same-origin frames and passes meshes with `postMessage`. Shared code lives in `packages/`.

## Open questions

- **"MCMP":** this plan reads it as OpenMC (Monte Carlo particle transport). If you meant multi-component multiphase flow (Shan–Chen LBM), it becomes an extension of the wind tunnel solver in step 10 instead.
- **Printer:** which printer and slicer you use decides the build volume and the hand-off format for step 5.

Mirrorlab's own optics plan and issue-sized backlog are in [`apps/mirrorlab/PROJECT_PLAN.md`](apps/mirrorlab/PROJECT_PLAN.md) and [`apps/mirrorlab/docs/BACKLOG.md`](apps/mirrorlab/docs/BACKLOG.md).
