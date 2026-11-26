create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
      case when new.raw_app_meta_data ->> 'provider' = 'google' then
        coalesce(
          nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
          nullif(btrim(new.raw_user_meta_data ->> 'name'), '')
        )
      end,
      'Traveler'
    )
  );
  return new;
end;
$$;

-- Repair untouched profiles that received the old signup default.
with google_names as (
  select id, coalesce(
    nullif(btrim(raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(raw_user_meta_data ->> 'name'), '')
  ) as display_name
  from auth.users
  where raw_app_meta_data ->> 'provider' = 'google'
    and raw_user_meta_data ->> 'display_name' is null
)
update public.profiles as profile
set display_name = google_names.display_name
from google_names
where profile.id = google_names.id
  and profile.display_name = 'Traveler'
  and profile.updated_at = profile.created_at
  and google_names.display_name is not null
  and google_names.display_name <> profile.display_name;
