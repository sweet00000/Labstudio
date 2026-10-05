# Splat Tunnel integration plan

Splat Tunnel's source now lives unpacked at `apps/splattunnel/` in the LabStudio repository, imported unchanged from the supplied archive (SHA-256 `ef0a4edb0a58b3bb61c6b15d972ce10c257704644b32504b6f1f9be8c93fb545`) apart from README paths.

The archive's directory inventory, README, package manifest, renderer/main entry points, license, and site workflow were inspected to establish its intended boundaries. Its solver tests, cloud jobs, performance claims, and accuracy claims were **not independently run or verified** as part of Mirrorlab. Preserving it is not an endorsement of those claims.

## What to reuse, in order

| Original module | Proposed integration | Gate before accepting |
|---|---|---|
| `web/src/loaders.js` | File input adapter for STL, OBJ, GLB, PLY, scans/splats | Golden files; units, axis, scale, malformed input limits, attribute provenance |
| `web/src/voxelize.js` | Optional scan cleanup and voxelization job | Known geometry volume, resolution sensitivity, thin-feature loss, repeatability |
| `web/src/mesher.js` | Derived mesh generation | Watertightness, normals, topology, error bounds and retained raw input |
| `web/src/export.js` | Export adapters | Round-trip dimensions, units, orientation, valid format output |
| `web/src/lbm.js` | Experimental browser flow solver | Independently reproduced benchmark and grid/BC/Reynolds-number validation |
| `web/src/render.js` | Rendering ideas/field-visualization adapter | One authoritative scene transform; no duplicate camera/coordinate state |
| `aws/containers/foam/` | Optional reference CFD job | Pin solver/container version; validate case setup, mesh, BCs, residuals, output units |
| `aws/containers/splat/` | Optional reconstruction job | Data rights, reconstruction scale/calibration, quality evidence, resource caps |
| `aws/api/`, templates | Reference for later job infrastructure | Review authentication, quotas, cancellation, secret handling, deployment costs |

## What to keep separate

Mirror optics works with exact local analytic surfaces and Float64 rays. Splat Tunnel uses a flow lattice and GPU representations. They should share object transforms, units, source assets, and study metadata, not one numerical discretization.

A Gaussian splat model represents observed appearance. A voxelized or repaired solid is a derived estimate; it is not proof of manufacturing geometry. Do not derive precision mirror normals from reconstructed splats. For a scanned housing, preserve scale calibration and reconstruction uncertainty before assessing clearance or physical flow.

Splat Tunnel's AWS deploy workflow lives at the LabStudio root as `.github/workflows/splattunnel-aws.yml`. It does nothing until the repository variable `AWS_REGION` and secret `AWS_ROLE_ARN` are set, so no AWS resources are created by default.

## Initial adapter experiment

Use a simple known-dimension cube and sphere to test loader → transform → render → export round trips. Record bounding dimensions, winding, topology, and unit conversions. Follow with one raw scan and a separately retained cleaned mesh. Only then add a typed flow study with explicit BCs and a validated benchmark report.

Do not merge the old app's globals or cloud configuration into `app.js`. Move a validated module behind the project and job interfaces described in [ARCHITECTURE.md](ARCHITECTURE.md).
