-- Engagement XP integrity (SRS 3.1.3.1.a: XP once per landmark per day).
--
-- Before: the API checked for an earlier reward, inserted the visit, then
-- wrote profile.xp = old + 50 in a separate request. Two simultaneous requests
-- could both earn XP, two awards could overwrite each other, and a failure
-- between the two writes kept the visit but lost the XP for good (a retry saw
-- the visit and awarded 0).

-- 1. At most one XP-earning visit per user, landmark and Philippine calendar
--    day. Asia/Manila is UTC+8 with no DST, matching phtDate() in src/domain/xp.ts.
create unique index visits_one_reward_per_day
  on public.visits (user_id, landmark_id, ((timezone('Asia/Manila', created_at))::date))
  where xp_awarded > 0;

-- 2. Insert the visit and add its XP + streak in one transaction, adding XP
--    with xp = xp + n so concurrent awards both count. Returns
--    {"duplicate": true} when today's reward was already taken.
create or replace function public.record_visit(
  p_user_id uuid,
  p_landmark_id text,
  p_source text,
  p_xp integer,
  p_streak_count integer,
  p_last_active_date date
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v public.visits;
  p public.profiles;
  violated text;
begin
  begin
    insert into public.visits (user_id, landmark_id, source, xp_awarded)
    values (p_user_id, p_landmark_id, p_source, p_xp)
    returning * into v;
  exception when unique_violation then
    get stacked diagnostics violated = constraint_name;
    if violated = 'visits_one_reward_per_day' then
      return jsonb_build_object('duplicate', true);
    end if;
    raise;
  end;

  update public.profiles
  set xp = xp + p_xp,
      streak_count = p_streak_count,
      last_active_date = p_last_active_date
  where id = p_user_id
  returning * into p;

  if not found then
    raise exception 'profile % not found', p_user_id using errcode = 'P0002';
  end if;

  return jsonb_build_object('duplicate', false, 'visit', to_jsonb(v), 'profile', to_jsonb(p));
end;
$$;

-- Only the API (secret key = service_role) may record visits. Functions in
-- public are executable by anon/authenticated by default, which would let
-- clients grant themselves XP through PostgREST.
revoke execute on function public.record_visit(uuid, text, text, integer, integer, date) from public, anon, authenticated;
grant execute on function public.record_visit(uuid, text, text, integer, integer, date) to service_role;
