-- Read-only post-migration assertions for project nbvylffxmjmovyfhbytu.
-- Run with a privileged SQL connection after applying the phase 1 migration.
-- This checks effective grants and RLS definitions without touching user rows.
begin read only;

do $checks$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'attendance_records'
      and cmd in ('INSERT', 'UPDATE', 'ALL')
  ) then
    raise exception 'employee direct attendance writes remain possible';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'leave_requests'
      and cmd in ('UPDATE', 'ALL') and policyname <> 'leave_admin_update'
  ) then
    raise exception 'non-admin leave update policy remains';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'leave_requests'
      and policyname = 'leave_create' and cmd = 'INSERT'
      and with_check like '%auth.uid()%'
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'leave_requests'
      and policyname = 'leave_read' and cmd = 'SELECT'
      and qual like '%auth.uid()%'
  ) then
    raise exception 'employee own leave create/read policy missing';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'leave_requests'
      and policyname = 'leave_admin_update' and cmd = 'UPDATE'
      and qual like '%is_admin()%'
      and with_check like '%is_admin()%'
  ) then
    raise exception 'admin-only leave decision policy missing';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'employee_profiles'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'employee_profiles'
      and policyname = 'employees can read their own profile'
      and cmd = 'SELECT' and roles = '{authenticated}'
      and qual like '%auth.uid()%'
      and qual like '%is_active%'
  ) then
    raise exception 'Tennis profile RLS changed';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in ('employee_profiles', 'employee_activity_sessions',
                        'attendance_records', 'leave_requests')
      and (roles @> array['anon']::name[] or roles @> array['public']::name[])
  ) then
    raise exception 'anonymous data policy exists on protected table';
  end if;

  if has_function_privilege('anon', 'public.employee_login_email(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.employee_login_email(text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.employee_login_email(text)', 'EXECUTE')
  then
    raise exception 'employee ID email lookup grants are incorrect';
  end if;

  if has_function_privilege('anon', 'public.check_in()', 'EXECUTE')
     or has_function_privilege('anon', 'public.check_out()', 'EXECUTE')
     or has_function_privilege('anon', 'public.correct_attendance(uuid,timestamptz,timestamptz,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.is_admin()', 'EXECUTE')
  then
    raise exception 'legacy privileged RPC is still callable anonymously';
  end if;

  if not has_function_privilege('authenticated', 'public.check_in()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.check_out()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.correct_attendance(uuid,timestamptz,timestamptz,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.is_admin()', 'EXECUTE')
  then
    raise exception 'authenticated legacy RPC access was lost';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.employee_profiles'::regclass
      and conname = 'employee_profiles_role_check' and convalidated
  ) or exists (
    select 1 from public.employee_profiles
    where role not in ('Employee', 'Co-CEO')
  ) then
    raise exception 'Tennis role integrity check failed';
  end if;

  if not has_table_privilege('service_role', 'public.employee_profiles', 'SELECT')
     or not has_table_privilege('service_role', 'public.employee_activity_sessions', 'SELECT')
     or not has_table_privilege('service_role', 'public.employee_activity_sessions', 'INSERT')
     or not has_table_privilege('service_role', 'public.employee_activity_sessions', 'UPDATE')
  then
    raise exception 'Edge Function service-role table access was lost';
  end if;
end
$checks$;

select 'phase1_catalog_checks_passed' as result;
commit;
