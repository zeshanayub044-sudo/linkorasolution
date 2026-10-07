-- The active employee profile is the sole source of administrator authority.
-- Legacy Blog and Careers role rows remain for historical compatibility only.
create schema if not exists admin_private;
revoke all on schema admin_private from public, anon, authenticated;

create function admin_private.is_active_co_ceo()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.employee_profiles as profile
    where profile.id = (select auth.uid())
      and profile.is_active = true
      and profile.role = 'Co-CEO'
  );
$$;
revoke all on function admin_private.is_active_co_ceo() from public, anon, authenticated;

create or replace function career_private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select admin_private.is_active_co_ceo();
$$;

create or replace function blog_private.current_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when admin_private.is_active_co_ceo() then 'blog_admin' else null end;
$$;

-- Existing attendance-admin RLS and correction RPCs now use the same rule.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select admin_private.is_active_co_ceo();
$$;

-- Both existing Co-CEOs need author metadata to create Blog posts. This row
-- is attribution, not an authorization grant; access is checked above.
insert into public.blog_authors (id, display_name)
select profile.id, left(profile.full_name, 100)
from public.employee_profiles as profile
where profile.role = 'Co-CEO' and profile.is_active = true
on conflict (id) do nothing;

-- Browser roles have no reason to own or truncate employee data. Existing
-- employee self-reads continue through the SELECT policy; writes use the
-- authenticated Edge Function after server-side authorization.
revoke all on public.employee_profiles, public.employee_activity_sessions from anon, authenticated;
grant select on public.employee_profiles to authenticated;
