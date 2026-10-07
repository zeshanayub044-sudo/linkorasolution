-- A stale tab may hold an old session UUID after a newer sign-in. Close the
-- employee's current open session if that UUID no longer names an open one.
create or replace function public.portal_employee_end_session(p_user_id uuid, p_session_id uuid default null)
returns jsonb language plpgsql set search_path = '' as $$
declare v_session public.employee_activity_sessions%rowtype;
begin
  perform 1 from public.employee_profiles where id = p_user_id for update;
  if not found then raise exception 'Employee profile not found' using errcode = 'P0002'; end if;
  if p_session_id is not null then
    select * into v_session from public.employee_activity_sessions
    where employee_id = p_user_id and session_id = p_session_id and status = 'Logged In'
    for update;
  end if;
  if v_session.session_id is null then
    select * into v_session from public.employee_activity_sessions
    where employee_id = p_user_id and status = 'Logged In'
    order by login_at desc limit 1 for update;
  end if;
  if v_session.session_id is null then
    return jsonb_build_object('alreadyClosed', true, 'sessionId', p_session_id);
  end if;
  update public.employee_activity_sessions
  set logout_at = greatest(now(), v_session.login_at), status = 'Logged Out',
      logout_source = 'user'
  where session_id = v_session.session_id;
  return jsonb_build_object('alreadyClosed', false, 'sessionId', v_session.session_id);
end;
$$;

-- Keep the existing sessions RPC for compatibility. This variant filters in
-- Postgres before applying pagination, so the result count remains accurate.
create function public.portal_attendance_sessions_filtered(
  p_from date, p_to date, p_employee uuid default null,
  p_status text default null, p_limit integer default 100, p_offset integer default 0)
returns table (
  session_id uuid, user_id uuid, employee_id text, full_name text, scheme text,
  login_at timestamptz, logout_at timestamptz, status text,
  login_source text, logout_source text, login_reason text, logout_reason text,
  corrected_by uuid, corrected_at timestamptz, correction_reason text,
  worked_minutes bigint, total_count bigint
) language plpgsql stable security definer set search_path = '' as $$
declare v_timezone text;
begin
  if not public.is_admin() then raise exception 'Co-CEO access required' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366
    or p_limit not between 1 and 200 or p_offset not between 0 and 100000
    or (p_status is not null and p_status not in ('Logged In','Logged Out','Needs Review')) then
    raise exception 'Invalid history filter or page' using errcode = '22023';
  end if;
  select timezone into v_timezone from public.company_settings where id = true;
  return query
  select a.session_id,a.employee_id,p.employee_id,p.full_name,p.scheme,
    a.login_at,a.logout_at,a.status,a.login_source,a.logout_source,
    a.login_reason,a.logout_reason,a.corrected_by,a.corrected_at,a.correction_reason,
    case when a.logout_at is null then null
      else greatest(0,floor(extract(epoch from a.logout_at-a.login_at)/60))::bigint end,
    count(*) over()
  from public.employee_activity_sessions a
  join public.employee_profiles p on p.id=a.employee_id
  where a.login_at >= (p_from::timestamp at time zone v_timezone)
    and a.login_at < ((p_to+1)::timestamp at time zone v_timezone)
    and (p_employee is null or a.employee_id=p_employee)
    and (p_status is null or a.status=p_status)
  order by a.login_at desc limit p_limit offset p_offset;
end;
$$;
revoke all on function public.portal_attendance_sessions_filtered(date,date,uuid,text,integer,integer)
  from public, anon, authenticated;
grant execute on function public.portal_attendance_sessions_filtered(date,date,uuid,text,integer,integer)
  to authenticated;
