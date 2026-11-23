-- Terms of Use acceptance (consent record). Set only by the API (PATCH /v1/me
-- with acceptTerms: true); clients have no write policy on profiles.
alter table public.profiles add column terms_accepted_at timestamptz;

-- Email sign-ups had to tick the Terms checkbox, so record that at account
-- creation. Google accounts never saw it and stay null until they complete
-- their profile in the app.
update public.profiles p
set terms_accepted_at = u.created_at
from auth.users u
where u.id = p.id
  and coalesce(u.raw_app_meta_data ->> 'provider', 'email') = 'email';
