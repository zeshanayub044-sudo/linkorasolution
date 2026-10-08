-- Phase 1 security hardening against the live schema on 2026-09-30.
-- No table, function, Auth user, or application data is removed.
-- The legacy admin role is defined by public.is_admin(); Tennis roles remain
-- authoritative in public.employee_profiles and are not moved to JWT metadata.

-- A staff member may submit and read their own leave request. Approval/rejection
-- remains available only through the existing is_admin()-gated policy.
drop policy if exists leave_update on public.leave_requests;

-- Attendance timestamps and correction fields must come from the existing
-- SECURITY DEFINER check_in(), check_out(), and correct_attendance() RPCs.
-- The last RPC checks public.is_admin() and records an audit_log entry.
drop policy if exists attendance_insert on public.attendance_records;
drop policy if exists attendance_update on public.attendance_records;

-- Remove legacy email-by-employee-ID enumeration. No checked-in frontend
-- invokes this RPC. Keep it available only to trusted service-role code.
revoke execute on function public.employee_login_email(text)
  from public, anon, authenticated;
grant execute on function public.employee_login_email(text) to service_role;

-- The existing attendance RPCs have a built-in active-user/admin guard, but
-- anonymous callers have no reason to reach these SECURITY DEFINER functions.
revoke execute on function public.check_in()
  from public, anon;
revoke execute on function public.check_out()
  from public, anon;
revoke execute on function public.correct_attendance(uuid, timestamptz, timestamptz, text)
  from public, anon;
revoke execute on function public.is_admin()
  from public, anon;
grant execute on function public.check_in() to authenticated;
grant execute on function public.check_out() to authenticated;
grant execute on function public.correct_attendance(uuid, timestamptz, timestamptz, text)
  to authenticated;
grant execute on function public.is_admin() to authenticated;

-- Production currently contains only Employee and Co-CEO. Use a constraint
-- rather than a JWT claim so the database remains the Tennis role authority.
do $phase1$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.employee_profiles'::regclass
      and conname = 'employee_profiles_role_check'
  ) then
    alter table public.employee_profiles
      add constraint employee_profiles_role_check
      check (role in ('Employee', 'Co-CEO'));
  end if;
end
$phase1$;

-- Fail the migration atomically if a new permissive policy appeared between
-- review and deployment. A fresh legacy write policy needs a separate review.
do $phase1$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'attendance_records'
      and cmd in ('INSERT', 'UPDATE', 'ALL')
  ) then
    raise exception 'Unsafe attendance_records write policy remains';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'leave_requests'
      and cmd in ('UPDATE', 'ALL') and policyname <> 'leave_admin_update'
  ) then
    raise exception 'Unexpected leave_requests update policy remains';
  end if;
  if has_function_privilege('anon', 'public.employee_login_email(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.employee_login_email(text)', 'EXECUTE')
  then
    raise exception 'employee_login_email is still callable by a browser role';
  end if;
end
$phase1$;
