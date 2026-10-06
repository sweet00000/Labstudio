# Publish the browser app

Mirrorlab lives in the LabStudio monorepo at `apps/mirrorlab/`. The GitHub Actions workflows are at the repository root in `.github/workflows/`, because GitHub only runs workflows from there.

## Enable the static browser apps

1. In the repository, open **Settings → Pages** and choose **GitHub Actions** as the source.
2. Open **Actions → pages → Run workflow**, using the `main` branch.
3. The workflow runs the tests and publishes LabStudio. The site root opens the studio, where Mirrorlab is the **Optics** tab; it is also reachable on its own at `/apps/mirrorlab/web/`. GitHub prints the URL in the deployment output.
4. For automatic updates after source changes, add the repository variable **ENABLE_GITHUB_PAGES = true** under **Settings → Secrets and variables → Actions → Variables**.

Before that variable is set, pushes still run the ordinary `ci` workflow; they do not attempt a Pages deployment. Pages on a private repository depends on your GitHub plan.

All app asset and Worker URLs are relative, so the app works under any sub-path. Do not hard-code a root `/src/...` path when extending it.

## Workflows

- `ci.yml`: studio CAD tests, Mirrorlab numerical tests and builds; Splat Tunnel exporter and API tests. Runs on every push and pull request.
- `pages.yml`: manual deployment, or opt-in deployment on matching `main` changes. Write permissions are limited to the deploy job.
- `browser.yml`: manual studio and Mirrorlab browser checks with screenshots kept as a workflow artifact.
- `splattunnel-aws.yml`: optional Splat Tunnel AWS backend; inert until configured.

See [GitHub's custom Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
