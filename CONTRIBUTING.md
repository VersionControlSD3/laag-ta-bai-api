# Contributing

1. Read [docs/branching.md](docs/branching.md). Branch from `develop`: `feature/<name>` or `fix/<name>`.
2. `npm ci`, `cp .env.example .env`, `npm run dev`.
3. Before pushing: `npm run lint && npm run lint:openapi && npm run typecheck && npm test && npm run build`.
4. Changing a request or response? Update `openapi.yaml` in the same PR and link the matching
   frontend PR (`src/api/types.ts`).
5. Changing the schema? Add a migration (`npx supabase migration new <name>`) and, if seed
   content changed, run `npm run db:seed-sql`.
6. Open a PR into `develop` using the template. CI must be green and one teammate must approve.

Never commit `.env`, keys, tokens or passwords.
