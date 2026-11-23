-- ---------------------------------------------------------------------------
-- Saved Places / Bookmarks (SRS 3.1.1.3.c, SRS 3.6.3.2)
-- ---------------------------------------------------------------------------
create table public.saved_places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  landmark_id text not null references public.landmarks (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, landmark_id)
);

create index saved_places_user_created_idx on public.saved_places (user_id, created_at desc);

alter table public.saved_places enable row level security;

create policy "Users can view own saved places"
  on public.saved_places for select to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert own saved places"
  on public.saved_places for insert to authenticated
  with check (auth.uid() = user_id);

create policy "Users can delete own saved places"
  on public.saved_places for delete to authenticated
  using (auth.uid() = user_id);

grant select, insert, delete on public.saved_places to authenticated;
