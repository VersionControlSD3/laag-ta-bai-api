# laag-ta-bai-api

Backend API for **Laag ta bAI**, the AI travel companion for Cebu heritage sites.
It serves landmark data, runs the Gemini-powered *Scan-to-Story* and *Ask bAI*
features, and tracks traveler XP, streaks, quests and badges in Supabase.

The frontend lives in [`laag-ta-bai-frontend`](https://github.com/VersionControlSD3/laag-ta-bai-frontend).
The contract between the two is [`openapi.yaml`](openapi.yaml).

| | |
|---|---|
| Runtime | Node.js 22, TypeScript, Express 5 |
| Validation | Zod |
| Database & auth | Supabase (Postgres + Auth), migrations in `supabase/` |
| AI | Google Gemini via `@google/genai` (server-side key only) |
| Tests | Vitest + Supertest |
| Hosting | Vercel (serverless function), deployed by GitHub Actions |

## Quick start

Requires Node.js 22.12+ and npm.

```sh
npm ci
cp .env.example .env    # optional: works with no values filled in
npm run dev             # http://localhost:3000
```

With an empty `.env` the API runs in **memory mode**: seed landmarks and quests in
process memory, stubbed Gemini replies, and a local dev login
(`Authorization: Bearer dev:<any-id>`). That is enough to run the frontend end to end.

```sh
curl localhost:3000/health
curl "localhost:3000/v1/landmarks?lat=10.2937&lng=123.902"
curl -H "Authorization: Bearer dev:me" localhost:3000/v1/me
```

### Using a real Supabase project

1. Local stack (needs Docker): `npm run db:start`. It prints the API URL and keys.
   Migrations and `supabase/seed.sql` are applied automatically; `npm run db:reset` re-applies them.
2. Or hosted: link with `npx supabase link --project-ref <ref>` and run `npx supabase db push`.
3. Set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in `.env` and restart. `/health` should report `"dataSource":"supabase"`.

### Using Gemini

Set `GEMINI_API_KEY` (from Google AI Studio). `GEMINI_MODEL` defaults to `gemini-flash-latest`.
`/health` reports `"ai":"gemini"` when the key is set.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start with reload (tsx watch), loads `.env` |
| `npm run build` / `npm start` | Compile to `dist/` and run it |
| `npm run lint` | ESLint |
| `npm run lint:openapi` | Validate `openapi.yaml` |
| `npm run typecheck` | TypeScript, no emit |
| `npm test` | Vitest (memory store, stubbed AI) |
| `npm run db:seed-sql` | Regenerate `supabase/seed.sql` from `src/data/seed.ts` |
| `npm run db:start` / `db:stop` / `db:reset` | Local Supabase stack |

## Environment variables

See [`.env.example`](.env.example). Never commit `.env`.

| Variable | Required | Notes |
|---|---|---|
| `PORT` | no | Default `3000` |
| `NODE_ENV` | no | `development`, `test` or `production`. Production refuses to start without Supabase |
| `CORS_ORIGINS` | yes in deploys | Comma-separated frontend origins |
| `DATA_SOURCE` | no | `memory` or `supabase`; inferred from the Supabase variables |
| `SUPABASE_URL` | for Supabase | Project URL |
| `SUPABASE_SECRET_KEY` | for Supabase | Secret / service_role key. **Server only**, bypasses RLS |
| `GEMINI_API_KEY` | for real AI | Stubbed replies without it |
| `GEMINI_MODEL` | no | Default `gemini-flash-latest` |
| `ALLOW_DEV_AUTH` | no | Dev tokens only work in memory mode and never in production |

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | – | Status, data source, AI mode |
| GET | `/v1/landmarks` | – | Search, filter, sort by distance |
| GET | `/v1/landmarks/:id` | – | Detail with story sections |
| GET | `/v1/quests` | optional | Quests, with progress when signed in |
| POST | `/v1/scan` | optional | Photo → landmark (multipart `image`, `lat`, `lng`) |
| POST | `/v1/chat` | optional | Ask the AI guide about a landmark |
| GET / PATCH | `/v1/me` | required | Profile, rank, stats, badges, visits |
| POST | `/v1/me/visits` | required | Manual check-in |

Full request and response shapes: [`openapi.yaml`](openapi.yaml).

## Documentation

- [Architecture](docs/architecture.md): layers, data model, auth, AI flow
- [CI/CD and deployment](docs/ci-cd.md): workflows, secrets, environments, rollback
- [Branching and branch protection](docs/branching.md)
- [Contributing](CONTRIBUTING.md)
