-- The daily report deliberately shows first arrival. Live elapsed time must
-- instead use the newest valid open session, including after a same-day return.
create function public.portal_attendance_live()
returns table(user_id uuid, session_id uuid, login_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_timezone text; v_hours integer;
begin
  if not public.is_admin() then raise exception 'Co-CEO access required' using errcode='42501'; end if;
  select timezone,max_session_hours into v_timezone,v_hours
  from public.company_settings where id=true;
  return query
  select distinct on (a.employee_id) a.employee_id,a.session_id,a.login_at
  from public.employee_activity_sessions a
  join public.employee_profiles p on p.id=a.employee_id
  where a.status='Logged In' and p.is_active
    and (a.login_at at time zone v_timezone)::date=(now() at time zone v_timezone)::date
    and a.login_at<=now() and a.login_at>now()-make_interval(hours=>v_hours)
  order by a.employee_id,a.login_at desc;
end;
$$;
revoke all on function public.portal_attendance_live() from public,anon,authenticated;
grant execute on function public.portal_attendance_live() to authenticated;
