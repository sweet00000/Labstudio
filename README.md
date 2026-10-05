# LabStudio

One browser codebase for engineering simulation: optics ray tracing, wind tunnel and fluid mechanics, particle transport, all around a shared CAD and project model.

Each module is a static web app today. They are being pulled together behind one project format, one unit system and one geometry pipeline. See [ROADMAP.md](ROADMAP.md) for the plan.

## Modules

| Module | Path | What it does | Runs on | Status |
|---|---|---|---|---|
| Mirrorlab | [`apps/mirrorlab`](apps/mirrorlab) | Mirror optics: exact 3D ray tracing on plane, spherical and parabolic surfaces; pupil, eyebox, parameter sweeps | WebGL 2, Float64 worker | v0.1, 20 physics tests |
| Splat Tunnel | [`apps/splattunnel`](apps/splattunnel) | Scans or meshes into a D3Q19 lattice-Boltzmann wind tunnel; CAD export; optional OpenFOAM and splat jobs on AWS | WebGPU | Working; exporter and API tests in CI |
| CAD workspace | planned | Parametric solids, STEP in/out, shared by every solver | | Not started |
| Particle transport (OpenMC) | planned | Monte Carlo neutron/photon transport as a cloud job, CAD geometry in, tallies back | | Not started |

## Run locally

```sh
# Mirrorlab (Node 22+)
cd apps/mirrorlab && npm run dev              # http://localhost:5173
npm test

# Splat Tunnel (needs a WebGPU browser)
cd apps/splattunnel/web && python3 -m http.server 8000
deno run -A test/export_test.js               # mesher + exporters
python3 ../aws/tests/test_api.py              # needs: pip install "moto[s3]" boto3
```

## Repository layout

```
apps/mirrorlab/       optics ray tracer (own README, docs/, tests/)
apps/splattunnel/     wind tunnel + scan-to-CAD, optional AWS backend in aws/
site/                 hub page published at the root of GitHub Pages
.github/workflows/    ci (all tests), pages (hub + apps), browser (manual), splattunnel-aws (inert until configured)
ROADMAP.md            current state and what to build next
```

## Publish on GitHub Pages

Settings → Pages → Source: **GitHub Actions**, then run the **pages** workflow from Actions. To redeploy on every push to `main`, add the repository variable `ENABLE_GITHUB_PAGES = true`. The site serves the hub at `/`, Mirrorlab at `/mirrorlab/` and Splat Tunnel at `/splattunnel/`.

## License

The repository root carries GPL-3.0. Mirrorlab and Splat Tunnel were written under MIT and keep their own `LICENSE` files. See the license note in [ROADMAP.md](ROADMAP.md) before adding dependencies.
