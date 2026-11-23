# Landmark Data Management & Seeding Guide

This guide explains how to add, edit, and populate heritage landmark data in **Laag ta bAI** across both the backend API and frontend apps.

---

## 1. How It Works

Landmark records serve as the curated catalog of supported heritage sites. They are used for:
- **Map & Explore Screens:** Rendering places, categories, opening hours, and fees.
- **AI Grounding:** Providing Gemini with verified candidate lists (for image recognition) and authentic historical facts (for the **"Ask bAI"** chat guide).
- **GPS Validation:** Verifying user proximity (within 500m) to unlock badges and XP.

```
src/data/seed.ts (Single Source of Truth)
   │
   ├─► In-Memory Store (npm run dev / vitest)
   │
   └─► scripts/generate-seed-sql.ts ──► supabase/seed.sql ──► Supabase Postgres (landmarks table)
```

> **Note on AI Recognition:** Gemini does **not** dynamically create or overwrite landmark records. Gemini matches user-submitted camera photos against this fixed catalog. User check-ins and scans are saved to user-specific tables (`visits`, `profiles`), leaving the landmark catalog pristine.

---

## 2. Step-by-Step: Adding a New Landmark

### Step 1: Add the Landmark Object in `src/data/seed.ts` (API)

Open `src/data/seed.ts` and append your landmark to the `LANDMARKS` array:

```typescript
{
  id: 'cebu-metropolitan-cathedral',          // Unique lowercase slug identifier
  name: 'Cebu Metropolitan Cathedral',         // Display name
  category: 'church',                         // Enum: 'church' | 'fort' | 'monument' | 'museum' | 'heritage_house' | 'temple'
  district: 'Cebu City (Downtown)',           // District or area name
  latitude: 10.2961,                          // Decimal GPS coordinates
  longitude: 123.9036,
  imageUrl: '/landmarks/cathedral.jpg',       // Relative path in frontend public folder (or null)
  admissionFee: 0,                            // Entrance fee in PHP (0 for free)
  rating: 4.6,                                // Baseline rating (0 to 5)
  visitCount: 0,                              // Initial visitor count (typically 0)
  estimatedVisitMinutes: 30,                  // Recommended visit duration in minutes
  visitingHours: '6:00 AM - 7:00 PM',         // Visitor schedule string
  story: {                                    // Verified historical record used by bAI tour guide
    about:
      'The ecclesiastical seat of the Metropolitan Archdiocese of Cebu, established in 1595.',
    significance:
      'One of the oldest dioceses in the Philippines, serving as a cradle of Christian faith in the Visayas.',
    architecture:
      'Typical Spanish colonial baroque church architecture featuring thick coral stone walls and a trefoil pediment.',
    trivia:
      'Much of the church structure was heavily damaged by Allied bombings during World War II and was reconstructed in the 1950s.',
  },
},
```

#### Field Specifications & Constraints

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique kebab-case slug (e.g., `fort-san-pedro`). |
| `name` | `string` | Official name of the landmark. |
| `category` | `LandmarkCategory` | Must be one of: `'church'`, `'fort'`, `'monument'`, `'museum'`, `'heritage_house'`, `'temple'`. |
| `district` | `string` | District or neighborhood (e.g., `'Parian, Cebu City'`). |
| `latitude` | `number` | Float between `-90` and `90`. |
| `longitude` | `number` | Float between `-180` and `180`. |
| `imageUrl` | `string \| null` | URL or relative frontend path (e.g., `'/landmarks/my-image.jpg'`). |
| `admissionFee` | `number` | Numeric price in PHP. `0` indicates free admission. |
| `rating` | `number` | Float between `0` and `5`. |
| `visitCount` | `number` | Non-negative integer. |
| `estimatedVisitMinutes` | `number` | Positive integer (in minutes). |
| `visitingHours` | `string` | Human-readable opening hours. |
| `story` | `object` | Structured object with non-empty string fields: `about`, `significance`, `architecture`, `trivia`. |

---

### Step 2: Add the Photo to the Frontend

Place the photo asset in the frontend repository:

```
laag-ta-bai-frontend/public/landmarks/<filename>.jpg
```

Make sure `<filename>.jpg` matches the `imageUrl` defined in `seed.ts` (e.g., `/landmarks/cathedral.jpg`).

---

### Step 3: (Optional) Assign Landmark to a Quest

If the landmark belongs to a thematic walking tour or quest, find `QUESTS` in `src/data/seed.ts` and add its `id` to the `landmarkIds` array:

```typescript
{
  id: 'spanish-colonial-trail',
  title: 'Spanish Colonial Heritage Trail',
  description: 'Walk the first Spanish settlement, from the fort by the sea to the oldest church.',
  badgeName: "Magellan's Chronicler",
  landmarkIds: [
    'fort-san-pedro',
    'magellans-cross',
    'basilica-santo-nino',
    'cebu-metropolitan-cathedral', // <-- Add here
  ],
}
```

---

### Step 4: Regenerate the Database Seed SQL

Run the seed compilation script from the `laag-ta-bai-api` root:

```bash
npm run db:seed-sql
```

This compiles `src/data/seed.ts` into `supabase/seed.sql` with parameterized SQL inserts:
```sql
insert into public.landmarks (id, name, category, district, ...) values
  ('cebu-metropolitan-cathedral', 'Cebu Metropolitan Cathedral', ...)
on conflict (id) do nothing;
```

---

### Step 5: Apply Changes to the Running Environment

Depending on how you are running the backend:

#### Option A: In-Memory Mode (Standard Local Dev & CI)
- No database step required!
- Simply restart the dev server:
  ```bash
  npm run dev
  ```
  The API immediately serves the updated landmarks from memory.

#### Option B: Local Supabase (Docker)
- Reset and re-apply migrations and seed data:
  ```bash
  npm run db:reset
  ```

#### Option C: Hosted Supabase Project (Staging / Production)
- Open your **Supabase Dashboard** -> **SQL Editor**.
- Copy the newly generated SQL block from `supabase/seed.sql` and run it.
- Alternatively, if your CLI is linked:
  ```bash
  npx supabase db push
  ```

---

## 3. Verifying the New Landmark

You can verify that the landmark is live using `curl` or the browser:

```bash
# 1. Fetch landmark details
curl http://localhost:3000/v1/landmarks/cebu-metropolitan-cathedral

# 2. Search by name or category
curl "http://localhost:3000/v1/landmarks?category=church&q=cathedral"

# 3. Check distance calculation with coordinates
curl "http://localhost:3000/v1/landmarks/cebu-metropolitan-cathedral?lat=10.2961&lng=123.9036"
```
