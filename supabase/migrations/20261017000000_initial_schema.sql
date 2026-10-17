-- Laag ta bAI initial schema.
-- Replaces the earlier prototype `public.users` table with `profiles`, which is
-- keyed to Supabase Auth users.

-- ---------------------------------------------------------------------------
-- Profiles (SRS 3.1.6.1) – one row per auth user
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Traveler',
  avatar_url text,
  nationality text,
  bio text check (char_length(bio) <= 280),
  language text not null default 'en' check (language in ('en', 'ceb')),
  xp integer not null default 0 check (xp >= 0),
  streak_count integer not null default 0 check (streak_count >= 0),
  last_active_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Landmarks (SRS 3.1.1, 3.1.4)
-- ---------------------------------------------------------------------------
create table public.landmarks (
  id text primary key,
  name text not null,
  category text not null check (category in ('church', 'fort', 'monument', 'museum', 'heritage_house', 'temple')),
  district text not null,
  latitude double precision not null,
  longitude double precision not null,
  image_url text,
  admission_fee numeric(10, 2) not null default 0,
  rating numeric(2, 1) not null default 0 check (rating between 0 and 5),
  visit_count integer not null default 0,
  estimated_visit_minutes integer not null default 30,
  visiting_hours text not null default '',
  story jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Quests and their landmarks (SRS 3.1.3.3)
-- ---------------------------------------------------------------------------
create table public.quests (
  id text primary key,
  title text not null,
  description text not null default '',
  badge_name text not null
);

create table public.quest_landmarks (
  quest_id text not null references public.quests (id) on delete cascade,
  landmark_id text not null references public.landmarks (id) on delete cascade,
  position integer not null default 0,
  primary key (quest_id, landmark_id)
);

-- ---------------------------------------------------------------------------
-- Visits / engagements (SRS 3.1.3.1, 3.1.6.1.b)
-- ---------------------------------------------------------------------------
create table public.visits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  landmark_id text not null references public.landmarks (id) on delete cascade,
  source text not null check (source in ('scan', 'chat', 'manual')),
  xp_awarded integer not null default 0,
  created_at timestamptz not null default now()
);
create index visits_user_created_idx on public.visits (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Reviews (SRS 3.1.1.4.b) – table only; API endpoints not built yet
-- ---------------------------------------------------------------------------
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  landmark_id text not null references public.landmarks (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  body text check (char_length(body) <= 1000),
  created_at timestamptz not null default now(),
  unique (user_id, landmark_id)
);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', 'Traveler'));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.increment_visit_count()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  update public.landmarks set visit_count = visit_count + 1 where id = new.landmark_id;
  return new;
end;
$$;

create trigger visits_increment_count
  after insert on public.visits
  for each row execute function public.increment_visit_count();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- The API uses the secret key (bypasses RLS) and always scopes by the verified
-- user id. These policies protect direct access with the publishable key.
-- XP and visits are written only by the API, so clients get no write policies.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.landmarks enable row level security;
alter table public.quests enable row level security;
alter table public.quest_landmarks enable row level security;
alter table public.visits enable row level security;
alter table public.reviews enable row level security;

create policy "Landmarks are public" on public.landmarks for select to anon, authenticated using (true);
create policy "Quests are public" on public.quests for select to anon, authenticated using (true);
create policy "Quest landmarks are public" on public.quest_landmarks for select to anon, authenticated using (true);
create policy "Reviews are public" on public.reviews for select to anon, authenticated using (true);

create policy "Users read own profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy "Users read own visits" on public.visits
  for select to authenticated using ((select auth.uid()) = user_id);

grant select on public.landmarks, public.quests, public.quest_landmarks, public.reviews to anon, authenticated;
grant select on public.profiles, public.visits to authenticated;
