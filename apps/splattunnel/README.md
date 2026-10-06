# Splat Tunnel

Drop a 3D scan into a GPU wind tunnel that runs in your browser, then export it as CAD.

- **In:** Gaussian splats (`.ply`, `.splat`), triangle-splat `.ply`, meshes (`.stl`, `.obj`, `.glb`), plain point clouds.
- **Clean:** splats are rasterized to a solid, floaters dropped, holes closed, and a watertight, manifold mesh is built from it.
- **Simulate:** a D3Q19 lattice Boltzmann solver with a Smagorinsky turbulence model, written in WebGPU compute shaders. It uses half-precision storage when the GPU supports it, so about 2 million cells fit in 200 MB. Smoke streaks, a speed slice, and live drag and lift.
- **Export (built in, no server):** STL, 3MF, GLB, OBJ and PLY in mm, m or inches, at full size or 1:10 to 1:100, Y-up or Z-up. Also cleaned splats (`.ply`, all SH bands kept), the flow field as VTK for ParaView, force history as CSV, or everything as one zip.
- **Cloud (optional, your AWS account):** photos or a video to Gaussian splats on spot GPUs (COLMAP + gsplat via nerfstudio), and full OpenFOAM runs (snappyHexMesh + simpleFoam k-ω SST) that come back as a ParaView-ready case, all behind a hard budget cap.

The web app is static files with no build step. It works on GitHub Pages or any web server.

## Run it

```sh
npm run dev        # from the repository root; then open http://localhost:5173/apps/splattunnel/web/
```

The geometry modules are shared with the rest of LabStudio in `packages/geometry/`, so serve the repository root rather than `web/` alone. Inside the studio, this app is the **Wind tunnel** tab, and the Model workspace can send parts straight into it. It loads the hatchback sample on start; add `?empty` to the URL to skip that.

```
```

It needs WebGPU: current Chrome or Edge on desktop or Android, or Safari 26 on iPhone, iPad and Mac. Firefox has WebGPU on Windows; Linux support varies.

## How accurate is it?

It's a qualitative tool for comparing shapes. These are the headless benchmarks in `web/test/` (run on a software GPU):

| Case | Grid | Splat Tunnel Cd | Reference |
|---|---|---|---|
| Sphere, Re = 50 | radius 5 → 12 cells | 1.98 → 1.83 | 1.54 (Schiller–Naumann) |
| Sphere, Re ≈ 4×10⁵ | 24 cells across | 0.57 | ≈ 0.47 (subcritical) |
| Cube, free stream | 16 cells | 1.15 | ≈ 1.05–1.2 |
| Cube on the floor | 16 cells | 1.45 | ≈ 1.2 (mirror image of a 2:1 block) |
| Hatchback sample (boxy, fixed wheels) | 32 cells long | 0.87 | real hatchbacks ≈ 0.3; a shape this crude, perhaps 0.5 |

Expect roughly +20% at the Standard grid, falling as the grid gets finer. So compare shapes against each other at the same grid setting rather than reading absolute numbers. The browser also runs at a far lower Reynolds number than the real flow (the app shows both numbers). The turbulence model covers some of that gap, but none of this is certification-grade. Use the OpenFOAM cloud job when the number matters.

Solver notes, for anyone extending it:
- A 10-cell sponge at the tunnel edges absorbs the acoustic noise that otherwise destabilizes low-viscosity BGK at the inlet/floor corner.
- The floor is free-slip: frictionless like a rolling road, without the corner singularity a moving belt creates under stationary wheels. Wheels don't spin.
- Forces use gauge populations, so bodies resting on the floor aren't pushed down by ambient pressure that has no fluid underneath to balance it.
- Bodies are seated flush on the floor; a half-cell offset once left a one-cell slot under them.

## Cloud jobs on AWS (about $0.10 to $0.60 per job)

Everything runs in **your** AWS account. The web app talks to a small API with an access key.

```
AWS CloudShell (in the AWS console, top bar ">_" icon)
$ git clone https://github.com/<you>/Labstudio && cd Labstudio/apps/splattunnel/aws
$ ./deploy.sh you@example.com
```

That creates:
- an HTTP API and two Lambda functions (jobs; budget guard)
- one S3 bucket (inputs expire after 7 days, results after 30)
- AWS Batch with **spot** GPU machines (g4dn/g5/g6 `.xlarge`, capped at 2 at once) and spot CPU machines (8 vCPU, capped at 2 at once), which scale to zero when idle
- a one-time CodeBuild run that builds the two containers (about $0.60)
- **a monthly budget** (default $100, set with `BUDGET=60 ./deploy.sh …`). It emails you at 50%, at 80%, and when the forecast passes 100%. At 95% it **disables the job queues and terminates running jobs**. It counts gross usage, because with promotional credits the net cost stays at $0 and a normal budget alarm would never fire.

No NAT gateway or always-on servers, so idle cost is roughly $0 plus a few cents of S3.

The script prints the **API address** and **access key**. Paste them into the app under *Cloud jobs → Connect*.

Rough costs (us-east-1 spot, 2026 prices vary):

| Job | Machine | Typical time | Cost |
|---|---|---|---|
| Photos → splats, 7,000 steps | g4dn.xlarge spot | 20–40 min incl. start-up | $0.10–0.25 |
| OpenFOAM, standard quality (~1–3 M cells) | c7i.2xlarge spot | 15–45 min | $0.05–0.15 |

**Before your first splat job:** new AWS accounts usually have a GPU quota of 0. `deploy.sh` checks it. If it's too low, request **"All G and VT Spot Instance Requests" ≥ 8** in Service Quotas; approval takes minutes to a day.

### Letting Claude (or anyone) manage it from GitHub

1. This app lives in the LabStudio repo at `apps/splattunnel/`; the workflows are at the repo root (`ci.yml`, `pages.yml`, `splattunnel-aws.yml`).
2. In CloudShell, run the one-time trust stack. It lets that repo's `main` branch deploy through short-lived OIDC credentials, so no AWS keys are stored anywhere:
   ```
   aws cloudformation deploy --template-file aws/github-oidc.yaml --stack-name splattunnel-github \
     --capabilities CAPABILITY_NAMED_IAM --parameter-overrides Repo=<you>/Labstudio
   ```
3. In the repo settings, add the secret `AWS_ROLE_ARN` (the stack's output) and the variable `AWS_REGION`.
4. Turn on GitHub Pages with source **GitHub Actions**.

From then on, merging to `main` runs the tests, publishes the site, and updates the AWS stack (and rebuilds containers when `apps/splattunnel/aws/containers/` changes). Open the repo in Claude Code (claude.ai/code) and changes go in as pull requests you approve.

## Layout

```
web/                    static app
  index.html style.css favicon.svg
  src/lbm.js            WebGPU lattice Boltzmann solver (D3Q19, LES, f16 storage)
  src/voxelize.js       tunnel sizing and LBM cell flags (voxel tools from packages/geometry)
  src/loaders.js mesher.js export.js samples.js
                        re-exports of packages/geometry/, shared with the CAD workspace
  src/render.js         WebGPU view: body, speed slice, smoke tracers
  src/main.js cloud.js
  test/                 headless tests (Deno WebGPU): solver benchmarks, export round-trips
aws/
  template.yaml         everything above (SAM / CloudFormation)
  deploy.sh             one-command deploy, --update for CI, --rebuild-images
  github-oidc.yaml      optional: let GitHub Actions deploy without keys
  api/app.py            API + budget guard Lambdas
  containers/foam/      OpenFOAM v2512 job (case generator: run_foam.py)
  containers/splat/     nerfstudio splatfacto job (run_splat.py)
  tests/test_api.py     API tests (moto)
```

## Tests

```sh
cd web && deno run -A test/export_test.js                               # mesher + every export format
deno run --unstable-webgpu -A test/lbm_sphere.js f16                   # solver vs Schiller–Naumann
deno run --unstable-webgpu -A test/pipeline_car.js car 32 4000          # full pipeline, road-car Reynolds number
python3 aws/tests/test_api.py                                           # API + budget guard
python3 aws/containers/foam/run_foam.py --local body.stl --out res --params '{"quality":"draft"}'
```

## Credits and licenses

Copyright © 2026 Alexander Sweet. Splat Tunnel is licensed under the GNU General Public License v3.0 or later; see [`LICENSE`](../../LICENSE) at the repository root. The cloud containers are built in your account from upstream sources and aren't redistributed here: [nerfstudio](https://github.com/nerfstudio-project/nerfstudio) and [gsplat](https://github.com/nerfstudio-project/gsplat) (Apache-2.0), [COLMAP](https://colmap.github.io/) (BSD), and [OpenFOAM](https://www.openfoam.com/) (GPL-3.0). B612 typeface by Airbus, SIL Open Font License.
