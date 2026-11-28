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
  update public.landmarks
  set visit_count = visit_count + (select visit_count from public.landmarks where id = dup)
  where id = keep;

  -- saved_places is unique per (user, landmark): drop bookmarks that would collide.
  delete from public.saved_places s
  where s.landmark_id = dup
    and exists (select 1 from public.saved_places k where k.user_id = s.user_id and k.landmark_id = keep);
  update public.saved_places set landmark_id = keep where landmark_id = dup;

  -- Remaining references (quest_landmarks, reviews) cascade.
  delete from public.landmarks where id = dup;
end;
$$;
