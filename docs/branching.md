# Branching and branch protection

## Branches

| Branch | Purpose | Deploys to |
|---|---|---|
| `main` | Production. Always releasable | Production (after approval) |
| `develop` | Integration and testing | Development |
| `feature/<short-name>` | New work, branched from `develop` | – |
| `fix/<short-name>` | Bug fixes, branched from `develop` | – |
| `hotfix/<short-name>` | Urgent production fix, branched from `main` | – |

## Flow

1. `git switch develop && git pull`, then `git switch -c feature/scan-retake-hints`.
2. Commit in small steps using [Conventional Commits](https://www.conventionalcommits.org/)
   (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`).
3. Open a PR into `develop`. CI must pass and one teammate must approve. Squash-merge.
4. To release, open a PR from `develop` into `main`. After merge, the production deploy
   waits for approval in the `production` environment.
5. Hotfixes: PR from `hotfix/*` into `main`, then merge `main` back into `develop`.

## Recommended GitHub settings

Settings → Branches → Add branch ruleset (or classic protection rule).

**`main`**
- Require a pull request before merging, 1 approval, dismiss stale approvals on new commits
- Require status checks to pass: **`Lint, test and build`**; require branches to be up to date
- Require conversation resolution
- Block force pushes and deletions
- Restrict who can push (no direct pushes), include administrators

**`develop`**
- Require a pull request before merging (1 approval)
- Require status check **`Lint, test and build`**
- Block force pushes and deletions

**Repository**
- Settings → General: allow squash merging only; enable "Automatically delete head branches".
- Settings → General: set the default branch to `develop` if you want PRs to target it by
  default. Keep `main` as default if you prefer; the Deploy workflow file must exist on the
  default branch for `workflow_run` triggers to fire.
- Settings → Environments: create `development` and `production`. On `production`, add
  required reviewers and limit deployment branches to `main`.

> Branch protection on private repositories needs a paid GitHub plan for organizations.
> On the free plan, keep these repositories public or rely on team discipline.
