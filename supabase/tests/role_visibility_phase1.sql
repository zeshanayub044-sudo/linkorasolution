-- Read-only RLS smoke tests using existing IDs without displaying them.
-- Run each transaction separately in a privileged SQL session. SET ROLE and
-- request.jwt.claim.sub simulate Data API database context; they do not create
-- or authenticate a browser session and do not invoke the Edge Function.

-- Ordinary Tennis employee: own active profile visible, other profiles and
-- activity rows invisible. Pick an employee with no legacy admin profile.
begin read only;
do $setup$ begin
  perform set_config('audit.employee_id',
    (select e.id::text from public.employee_profiles e
      left join public.profiles p on p.id = e.id
      where e.role = 'Employee' and e.is_active and p.id is null
      order by e.id limit 1), true);
end $setup$;
set local role authenticated;
select set_config('request.jwt.claim.sub',
                  current_setting('audit.employee_id'), true) is not null as employee_claim_set;
select auth.uid() is not null as employee_context,
       (select count(*) from public.employee_profiles where id = auth.uid()) as own_profile_rows,
       (select count(*) from public.employee_profiles where id <> auth.uid()) as other_profile_rows,
       (select count(*) from public.employee_activity_sessions) as direct_activity_rows,
       public.is_admin() as legacy_admin;
rollback;

-- Co-CEO retains own Tennis profile. Report authorization is separately
-- enforced inside manage-employee and needs a real browser/token smoke test.
begin read only;
do $setup$ begin
  perform set_config('audit.ceo_id',
    (select id::text from public.employee_profiles
      where role = 'Co-CEO' and is_active order by id limit 1), true);
end $setup$;
set local role authenticated;
select set_config('request.jwt.claim.sub',
                  current_setting('audit.ceo_id'), true) is not null as ceo_claim_set;
select auth.uid() is not null as ceo_context,
       (select count(*) from public.employee_profiles
         where id = auth.uid() and role = 'Co-CEO') as own_ceo_profile_rows,
       (select count(*) from public.employee_activity_sessions) as direct_activity_rows;
rollback;

-- Anonymous clients see no private rows and cannot execute the email lookup.
begin read only;
set local role anon;
select (select count(*) from public.employee_profiles) as profile_rows,
       (select count(*) from public.employee_activity_sessions) as activity_rows,
       (select count(*) from public.leave_requests) as leave_rows,
       (select count(*) from public.attendance_records) as attendance_rows,
       has_function_privilege('anon', 'public.employee_login_email(text)', 'EXECUTE')
         as email_lookup_exec;
rollback;

-- Service role still has the data access required by manage-employee.
begin read only;
set local role service_role;
select (select count(*) from public.employee_profiles) as profile_rows,
       (select count(*) from public.employee_activity_sessions) as activity_rows;
rollback;
