-- Bugs #11 and #16: Supabase Auth hides already-registered emails on sign-up
-- (it answers as if the account were new and emails the owner instead), so the
-- app showed a false "check your email" screen. The API asks this function
-- first and answers 409 instead. Only the API's secret key may call it.
create or replace function public.email_registered(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from auth.users where lower(email) = lower(trim(p_email)));
$$;

revoke all on function public.email_registered(text) from public, anon, authenticated;
grant execute on function public.email_registered(text) to service_role;
