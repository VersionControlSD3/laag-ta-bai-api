-- Scan-to-Story auto-discovery saved "Magellan's Cross Kiosk" as a new landmark
-- before the curated catalog was seeded, so later scans matched the duplicate
-- (no image) instead of magellans-cross. Merge it into the curated row.
-- No-op where the duplicate does not exist (e.g. production).
do $$
declare
  dup constant text := 'magellan-s-cross-kiosk';
  keep constant text := 'magellans-cross';
begin
  if not exists (select 1 from public.landmarks where id = dup)
     or not exists (select 1 from public.landmarks where id = keep) then
    return;
  end if;

  -- History and XP stay with the traveler; the visit_count trigger only fires
  -- on insert, so carry the count over explicitly.
  update public.visits set landmark_id = keep where landmark_id = dup;

  -- A traveler rewarded at both rows on the same day now has two rewarded
  -- visits for one landmark, which the one-reward-per-day index (next
  -- migration) forbids. Keep the earliest as the day's reward and record the
  -- rest as 0 XP. Profile XP is left alone: it was earned when the rows were
  -- separate landmarks.
  update public.visits v
  set xp_awarded = 0
  where v.landmark_id = keep
    and v.xp_awarded > 0
    and exists (
      select 1 from public.visits e
      where e.user_id = v.user_id
        and e.landmark_id = keep
        and e.xp_awarded > 0
        and (timezone('Asia/Manila', e.created_at))::date = (timezone('Asia/Manila', v.created_at))::date
        and (e.created_at, e.id) < (v.created_at, v.id)
    );
  update public.landmarks
  set visit_count = visit_count + (select visit_count from public.landmarks where id = dup)
  where id = keep;

  -- Every other reference is moved before the delete, because the foreign keys
  -- are ON DELETE CASCADE and would silently drop them. Each table is unique
  -- per (owner, landmark); where both landmarks are referenced, the curated
  -- row's existing entry wins.

  -- Bookmarks.
  delete from public.saved_places s
  where s.landmark_id = dup
    and exists (select 1 from public.saved_places k where k.user_id = s.user_id and k.landmark_id = keep);
  update public.saved_places set landmark_id = keep where landmark_id = dup;

  -- Quest stops keep their position.
  delete from public.quest_landmarks q
  where q.landmark_id = dup
    and exists (select 1 from public.quest_landmarks k where k.quest_id = q.quest_id and k.landmark_id = keep);
  update public.quest_landmarks set landmark_id = keep where landmark_id = dup;

  -- Reviews.
  delete from public.reviews r
  where r.landmark_id = dup
    and exists (select 1 from public.reviews k where k.user_id = r.user_id and k.landmark_id = keep);
  update public.reviews set landmark_id = keep where landmark_id = dup;

  delete from public.landmarks where id = dup;
end;
$$;
