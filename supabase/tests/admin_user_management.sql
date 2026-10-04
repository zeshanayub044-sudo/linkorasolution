-- Run against an existing Tennis Portal project. All changes are rolled back.
begin;
do $test$
declare
  actor_id uuid;
  target_id uuid;
  another_employee_id text;
  original_sessions integer;
  initial_status text;
  changed jsonb;
begin
  select id into actor_id from public.employee_profiles
    where is_active and role = 'Co-CEO' order by employee_id limit 1;
  select id into target_id from public.employee_profiles
    where is_active and role = 'Employee' order by employee_id limit 1;
  select p.employee_id into another_employee_id from public.employee_profiles p
    where p.id <> target_id order by p.employee_id limit 1;
  if actor_id is null or target_id is null or another_employee_id is null then
    raise exception 'Active Co-CEO and employee fixtures are required';
  end if;
  if has_function_privilege('authenticated', 'public.portal_admin_set_attendance(uuid,uuid,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.portal_admin_create_profile(uuid,uuid,text,text,text,text,boolean,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.portal_admin_update_profile(uuid,uuid,text,text,text,text,boolean,text,text)', 'EXECUTE')
     or has_table_privilege('authenticated', 'public.portal_admin_audit_log', 'SELECT') then
    raise exception 'Employee role has admin access';
  end if;
  select count(*) into original_sessions from public.employee_activity_sessions where employee_id = target_id;
  select case when exists (select 1 from public.employee_activity_sessions s
    where s.employee_id = target_id and s.status = 'Logged In') then 'Signed In' else 'Signed Out' end into initial_status;

  begin
    perform public.portal_admin_set_attendance(target_id, target_id, 'Signed Out', 'Unauthorized test');
    raise exception 'Employee actor changed attendance';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.portal_admin_update_profile(actor_id, target_id, lower(another_employee_id),
      'Duplicate ID', 'QA', 'Employee', true, 'old@example.test', 'old@example.test');
    raise exception 'Case-insensitive duplicate ID was allowed';
  exception when unique_violation then null;
  end;

  changed := public.portal_admin_set_attendance(actor_id, target_id,
    case when initial_status = 'Signed In' then 'Signed Out' else 'Signed In' end, 'QA first transition');
  if changed->>'previous_status' <> initial_status then raise exception 'Previous status incorrect'; end if;
  changed := public.portal_admin_set_attendance(actor_id, target_id, initial_status, 'QA second transition');
  if changed->>'new_status' <> initial_status then raise exception 'Second transition incorrect'; end if;
  if (select count(*) from public.employee_activity_sessions s where s.employee_id = target_id) < original_sessions then
    raise exception 'Historical sessions were deleted';
  end if;
  if not exists (select 1 from public.portal_admin_audit_log
    where target_user_id = target_id and reason = 'QA first transition') then
    raise exception 'Attendance audit missing';
  end if;

  perform public.portal_admin_update_profile(actor_id, target_id, 'QA-TRANSIENT-20261003',
    'QA Edited', 'QA', 'Employee', false, 'old@example.test', 'old@example.test');
  if not exists (select 1 from public.employee_profiles
    where id = target_id and not is_active and full_name = 'QA Edited') then
    raise exception 'Edit and disable failed';
  end if;
  if exists (select 1 from public.employee_activity_sessions s
    where s.employee_id = target_id and s.status = 'Logged In') then
    raise exception 'Disabling did not close open sessions';
  end if;
  if (select count(*) from public.employee_activity_sessions s where s.employee_id = target_id) < original_sessions then
    raise exception 'Disabling removed history';
  end if;
end;
$test$;
rollback;
