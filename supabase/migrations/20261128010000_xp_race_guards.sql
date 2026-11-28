-- Guards for concurrent engagements (SRS 3.1.3.1.a: XP once per landmark per day).
-- The API checks for an earlier reward before inserting, but two simultaneous
-- requests could both pass that check, and profile XP was read-modify-write.

-- 1. At most one XP-earning visit per user, landmark and Philippine calendar
--    day. The API treats a violation as a same-day repeat (xpAwarded 0).
--    Asia/Manila is UTC+8 with no DST, matching phtDate() in src/domain/xp.ts.
create unique index visits_one_reward_per_day
  on public.visits (user_id, landmark_id, ((timezone('Asia/Manila', created_at))::date))
  where xp_awarded > 0;

-- 2. Add XP in a single statement so concurrent awards both count.
create or replace function public.award_xp(
  p_user_id uuid,
  p_xp integer,
  p_streak_count integer,
  p_last_active_date date
)
returns public.profiles
language sql
set search_path = ''
as $$
  update public.profiles
  set xp = xp + p_xp,
      streak_count = p_streak_count,
      last_active_date = p_last_active_date
  where id = p_user_id
  returning *;
$$;

-- Only the API (secret key = service_role) may award XP. Functions in public
-- are executable by anon/authenticated by default, which would let clients
-- grant themselves XP through PostgREST.
revoke execute on function public.award_xp(uuid, integer, integer, date) from public, anon, authenticated;
grant execute on function public.award_xp(uuid, integer, integer, date) to service_role;
