# Contributing

Run `npm test` and `npm run build` before submitting a change. Use the optional browser test for viewport, interaction, import/export, or layout changes. See `docs/VALIDATION.md`.

Physics changes must state units, assumptions, sign conventions, and a meaningful independent physical case or invariant. Keep rendering mesh density separate from analytic optical surfaces. Never label a simulated result as experimentally validated without a measurement source and uncertainty.

Keep dependencies and cloud features scoped to a demonstrated need. Do not add secrets or paid-service defaults. Version the saved project schema before making an incompatible change, and provide a migration fixture. Tag plans as planned, implementations as implemented, and benchmark reports with their actual environment.

Use `docs/BACKLOG.md` to select the next feature and include the associated acceptance gate in the pull request description.
