# Working in LabStudio (for coding agents)

Browser engineering studio: CAD (`apps/studio`), optics ray tracing (`apps/mirrorlab`), GPU wind tunnel (`apps/splattunnel`), shared code in `packages/`. Plain ES modules, no build step, no runtime CDNs. Node 22+.

## Commands

| Task | Command |
|---|---|
| Serve everything | `npm run dev` → http://localhost:5173 |
| Unit tests (CAD, optics, band-gap physics, research helpers) | `npm test` |
| Geometry/export tests (needs Deno) | `npm run test:geometry` |
| Static site | `npm run build` → `_site/` |
| Browser driver (needs `npm install && npx playwright install chromium`) | `node tools/agent/drive.mjs <scenario.json>` |
| List clickable elements and selectors | `node tools/agent/drive.mjs --map [path]` |
| Literature search (needs `OPENALEX_API_KEY`, network access to api.openalex.org) | `node tools/research/openalex.mjs search "…"` |

Scenarios live in `tools/agent/scenarios/`; reports and screenshots go to `test-results/agent/<name>/`. Read `report.json` after every run. The browser driver's step reference is at the top of `tools/agent/drive.mjs`.

## Rules

- Units: millimetres and Z up in CAD; Mirrorlab optics are mm with Y up (see `opticsToWorld` in `apps/studio/web/src/templates.js`); physics kernels take eV, nm, K and cm⁻³ at their edges and use SI inside.
- Physics changes need a test against an independent value (a closed form, a limit, or a published number with its DOI) and a stated validity range.
- Never mark a simulated result as validated without a measurement and its uncertainty.
- Each app must keep working on its own; the studio hosts them in same-origin iframes and talks over `postMessage` (`labstudio:mesh`) or shared `localStorage` (`mirrorlab.project`).
- Commit as the repository owner; no AI attribution lines in commits.

## Open briefs

- [Tunable band-gap Materials workspace](docs/agents/BANDGAP_BRIEF.md): acceptance test `tools/agent/scenarios/materials-bandgap.json` (fails until built).
