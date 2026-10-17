# CI/CD and deployment

## Workflows

| File | Trigger | What it does |
|---|---|---|
| `.github/workflows/ci.yml` | PRs into `main`/`develop`, pushes to them, manual | `npm ci`, ESLint, OpenAPI lint, typecheck, Vitest, build |
| `.github/workflows/deploy.yml` | CI succeeded on a push to `develop` or `main`, or manual | Optional Supabase migrations, then Vercel build and deploy, then `/health` smoke test |
| `.github/dependabot.yml` | Weekly / monthly | Dependency and Actions update PRs into `develop` |

CI uses the in-memory store and stubbed Gemini, so it needs **no secrets**.

## Deployment is off until you turn it on

`deploy.yml` only runs when the repository variable `DEPLOY_ENABLED` is `true`. Until then,
CI still runs and nothing is deployed.

| Branch | GitHub Environment | Vercel target |
|---|---|---|
| `develop` | `development` | Preview deployment (optionally aliased to a stable URL) |
| `main` | `production` | Production (`--prod`) |

## One-time setup

1. **Vercel project**: create a project for this repo (Other framework). In Project →
   Settings → Environment Variables set, for **Production** and **Preview** separately:
   `NODE_ENV=production`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `GEMINI_API_KEY`,
   `GEMINI_MODEL` (optional), `CORS_ORIGINS` (the frontend URL for that environment).
   Use a separate Supabase project and Gemini key for development and production (SPMP 3.2).
   `vercel.json` disables Vercel's own Git auto-deploys so GitHub Actions is the only deployer.
2. **GitHub Environments**: Settings → Environments → create `development` and `production`.
   Add a required reviewer to `production`.
3. **Secrets** (add to each environment):

   | Secret | Where to get it |
   |---|---|
   | `VERCEL_TOKEN` | Vercel → Account Settings → Tokens |
   | `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | `.vercel/project.json` after `npx vercel link`, or Project Settings |
   | `SUPABASE_ACCESS_TOKEN` | Supabase → Account → Access Tokens (only if migrations are enabled) |
   | `SUPABASE_PROJECT_REF` | The project ref in the Supabase URL |
   | `SUPABASE_DB_PASSWORD` | The database password chosen when the project was created |

4. **Variables** (Settings → Secrets and variables → Actions → Variables):

   | Variable | Value |
   |---|---|
   | `DEPLOY_ENABLED` | `true` to turn deploys on |
   | `MIGRATIONS_ENABLED` | `true` to run `supabase db push` before each deploy (set per environment) |
   | `VERCEL_DEV_ALIAS` | Optional, e.g. `laag-ta-bai-api-dev.vercel.app` (in `development`) |

5. Push to `develop` and watch **Actions → Deploy**.

## Secrets policy

- Only placeholders live in `.env.example`. Real values go in `.env` (git-ignored), Vercel
  environment variables, or GitHub Secrets.
- Account logins (Gmail, Supabase, Vercel usernames and passwords) do not belong in any repo,
  `.env` file or GitHub Secret. Keep them in a password manager. Use access tokens for automation.
- If a secret is ever committed, rotate it immediately; deleting the commit is not enough.

## Database migrations

- Add a new file with `npx supabase migration new <name>`; never edit an applied migration.
- Test locally with `npm run db:reset`.
- With `MIGRATIONS_ENABLED=true`, the deploy job runs `supabase db push` before deploying code,
  so new code never meets an old schema. Keep migrations backward compatible with the
  previous release so a code rollback still works.

## Rollback

- Code: Vercel → Deployments → pick the last good production deployment → *Promote*
  (or *Instant Rollback*). Then revert the bad commit through a PR.
- Database: write a new forward migration that undoes the change. Supabase daily backups
  (paid plans) or point-in-time recovery are the last resort.

## Troubleshooting

- Reproduce CI locally: `npm ci && npm run lint && npm run lint:openapi && npm run typecheck && npm test && npm run build`.
- Deploy job skipped: check `DEPLOY_ENABLED` and that CI passed on a **push** (PRs don't deploy).
- Deploy job "Missing secret": the secret is missing from that GitHub Environment.
- 401 from preview smoke test: Vercel Deployment Protection is on; that step is non-blocking for previews.
