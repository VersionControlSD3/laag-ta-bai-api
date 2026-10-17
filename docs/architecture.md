# Architecture

```
 PWA (laag-ta-bai-frontend)
   │  Supabase Auth (sign in / sign up)  ──────────────►  Supabase Auth
   │  REST/JSON + Bearer access token
   ▼
 laag-ta-bai-api (Express on Vercel)
   ├─ middleware/auth  ── verifies the token with Supabase (auth.getUser)
   ├─ routes/*         ── Zod-validated handlers, /v1 prefix
   ├─ services/progress── XP, streaks, quest badges
   ├─ repositories/*   ── DataStore: memoryStore | supabaseStore
   └─ lib/ai           ── AiService: Gemini | stub
          │                           │
          ▼                           ▼
   Supabase Postgres            Google Gemini API
```

## Why this shape

- **Keys stay on the server** (SRS 3.5.1.2). Gemini and the Supabase secret key
  never reach the browser. The frontend only holds the Supabase publishable key, for sign-in.
- **One small Express app**. No microservices; the same `createApp()` runs locally
  (`src/server.ts`), in tests (Supertest) and on Vercel (`api/index.ts`).
- **Swappable data and AI** behind two interfaces (`DataStore`, `AiService`), so the
  app runs and is tested with zero external services, and CI needs no secrets.

## Layers

| Folder | Responsibility |
|---|---|
| `src/config` | Parse and validate environment variables (`loadEnv`) |
| `src/routes` | HTTP handlers. Parse input with Zod, call services/stores, shape `{ data }` |
| `src/middleware` | Auth (`optionalAuth`, `requireAuth`) and the error handler |
| `src/services` | Business rules: XP award, streak, quest completion |
| `src/domain` | Pure types and functions (ranks, haversine distance) |
| `src/repositories` | Data access (`DataStore`) for memory and Supabase |
| `src/lib` | Gemini client, Supabase client, retry helper, error types |
| `src/data/seed.ts` | Starter landmarks and quests; also generates `supabase/seed.sql` |

## Data model (Supabase)

`supabase/migrations/20261017000000_initial_schema.sql`:

| Table | Purpose |
|---|---|
| `profiles` | One per `auth.users` row (created by trigger). Name, bio, language, `xp`, `streak_count`, `last_active_date` |
| `landmarks` | Heritage sites with coordinates, fee, rating, hours, and `story` JSON (about, significance, architecture, trivia) |
| `quests`, `quest_landmarks` | Thematic routes of 3–5 landmarks and the badge they unlock |
| `visits` | Each engagement (scan, chat, manual check-in) and the XP it awarded |
| `reviews` | Ratings and reviews (table ready, endpoints not built yet) |

Row Level Security is on for every table. Landmarks, quests and reviews are publicly readable;
profiles and visits are readable only by their owner. All writes go through the API with the
secret key, which always scopes queries by the verified user id. Badges are derived from
visits rather than stored.

> The prototype in the old `Laag-ta-bai` repo had a `public.users` table. `profiles` replaces it.

## Request flows

**Scan-to-Story** (`POST /v1/scan`): validate the file type and size, sort landmarks by
distance from the optional GPS point, ask Gemini to pick one (structured JSON with a
confidence), then apply the SRS rules: confidence ≥ 0.8 and within 500 m means
`identified`; otherwise return up to five candidates within 1 km. A signed-in traveler
earns XP on success.

**Ask bAI** (`POST /v1/chat`): the client keeps the transcript and sends it each turn.
The server keeps the last 30 messages (15 exchanges), adds a system prompt grounded in the
landmark record, applies Gemini safety settings, and returns the reply.

**XP rules** (`services/progress.ts`): 50 XP per engagement, once per landmark per
Philippine calendar day; streak increments on consecutive days; rank thresholds in
`domain/xp.ts` (placeholders until the team sets them).

**Resilience**: Gemini calls retry up to three times with exponential backoff.
`/v1/scan` and `/v1/chat` are rate limited per IP (in-memory, so per serverless instance).

## Changing the API contract

1. Update `openapi.yaml` and the route in the same PR (`npm run lint:openapi`).
2. Mirror the change in the frontend's `src/api/types.ts` in a linked PR.
3. Prefer additive changes. For a breaking change, add a new field or route first,
   ship the frontend, then remove the old one.
