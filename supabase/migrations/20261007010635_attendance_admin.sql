-- Attendance remains in employee_activity_sessions. No historical session is
-- deleted or silently assigned a fabricated sign-out time.
alter table public.employee_activity_sessions
  drop constraint employee_activity_sessions_status_check;
alter table public.employee_activity_sessions
  add constraint employee_activity_sessions_status_check
  check (status in ('Logged In', 'Logged Out', 'Needs Review'));
alter table public.employee_activity_sessions
  add column corrected_by uuid references public.employee_profiles(id) on delete restrict,
  add column corrected_at timestamptz,
  add column correction_reason text;
alter table public.employee_activity_sessions
  add constraint employee_activity_sessions_integrity
  check (
    (status = 'Logged Out' and logout_at is not null and logout_at >= login_at)
    or (status in ('Logged In', 'Needs Review') and logout_at is null)
  );
create index employee_activity_sessions_login_at_idx
  on public.employee_activity_sessions (login_at desc);
create index employee_activity_sessions_review_idx
  on public.employee_activity_sessions (login_at desc)
  where status in ('Logged In', 'Needs Review');

-- The existing schedule is reused. These are additive settings, not a second
-- attendance calendar.
alter table public.company_settings
  add column expected_daily_minutes integer not null default 480
    check (expected_daily_minutes between 60 and 1440),
  add column max_session_hours integer not null default 16
    check (max_session_hours between 4 and 72);
revoke update on public.company_settings from anon, authenticated;

-- Track activation intervals so historical absence never starts before a
-- person joined or continues after their account was disabled.
create table public.employee_active_periods (
  id bigint generated always as identity primary key,
  employee_id uuid not null references public.employee_profiles(id) on delete restrict,
  started_at timestamptz not null,
  ended_at timestamptz,
  check (ended_at is null or ended_at >= started_at)
);
create unique index employee_active_periods_one_open_idx
  on public.employee_active_periods (employee_id) where ended_at is null;
create index employee_active_periods_history_idx
  on public.employee_active_periods (employee_id, started_at desc);
insert into public.employee_active_periods (employee_id, started_at)
select id, created_at from public.employee_profiles where is_active;
alter table public.employee_active_periods enable row level security;
revoke all on public.employee_active_periods from public, anon, authenticated;
grant select, insert, update on public.employee_active_periods to service_role;

create function admin_private.track_employee_active_period()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.is_active then
    insert into public.employee_active_periods(employee_id, started_at)
    values (new.id, coalesce(new.created_at, now()));
  elsif tg_op = 'UPDATE' and old.is_active is distinct from new.is_active then
    if new.is_active then
      insert into public.employee_active_periods(employee_id, started_at)
      values (new.id, now());
    else
      update public.employee_active_periods set ended_at = now()
      where employee_id = new.id and ended_at is null;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function admin_private.track_employee_active_period() from public, anon, authenticated;
create trigger employee_active_periods_track
after insert or update of is_active on public.employee_profiles
for each row execute function admin_private.track_employee_active_period();

-- Employee session changes are service-role-only RPCs called after Auth user
-- validation in manage-employee. They lock the profile to serialize starts.
create function public.portal_employee_start_session(p_user_id uuid, p_session_id uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_profile public.employee_profiles%rowtype;
  v_timezone text;
  v_day date;
  v_existing uuid;
  v_stale record;
begin
  select * into v_profile from public.employee_profiles
  where id = p_user_id for update;
  if not found or not v_profile.is_active then
    raise exception 'Employee account is not active' using errcode = '42501';
  end if;
  select timezone into v_timezone from public.company_settings where id = true;
  v_day := (now() at time zone v_timezone)::date;
  for v_stale in
    select session_id, login_at from public.employee_activity_sessions
    where employee_id = p_user_id and status = 'Logged In'
      and (login_at at time zone v_timezone)::date <> v_day
    for update
  loop
    update public.employee_activity_sessions set status = 'Needs Review'
    where session_id = v_stale.session_id;
    insert into public.portal_admin_audit_log
      (admin_name, target_user_id, target_name, action, before_state, after_state, reason)
    values ('System', p_user_id, v_profile.full_name, 'stale_session_flagged',
      jsonb_build_object('session_id', v_stale.session_id, 'status', 'Logged In', 'login_at', v_stale.login_at),
      jsonb_build_object('session_id', v_stale.session_id, 'status', 'Needs Review'),
      'Prior-day open session requires a Co-CEO review; no sign-out time was invented');
  end loop;
  select session_id into v_existing from public.employee_activity_sessions
  where employee_id = p_user_id and status = 'Logged In'
  order by login_at desc limit 1;
  if v_existing is not null then
    return jsonb_build_object('sessionId', v_existing, 'alreadyOpen', true);
  end if;
  insert into public.employee_activity_sessions
    (session_id, employee_id, login_at, status, login_source)
  values (p_session_id, p_user_id, now(), 'Logged In', 'user');
  return jsonb_build_object('sessionId', p_session_id, 'alreadyOpen', false);
end;
$$;
revoke all on function public.portal_employee_start_session(uuid,uuid) from public, anon, authenticated;
grant execute on function public.portal_employee_start_session(uuid,uuid) to service_role;

create function public.portal_employee_end_session(p_user_id uuid, p_session_id uuid default null)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_session public.employee_activity_sessions%rowtype;
begin
  perform 1 from public.employee_profiles where id = p_user_id for update;
  if not found then raise exception 'Employee profile not found' using errcode = 'P0002'; end if;
  select * into v_session from public.employee_activity_sessions
  where employee_id = p_user_id and status = 'Logged In'
    and (p_session_id is null or session_id = p_session_id)
  order by login_at desc limit 1 for update;
  if not found then
    return jsonb_build_object('alreadyClosed', true, 'sessionId', p_session_id);
  end if;
  update public.employee_activity_sessions
  set logout_at = greatest(now(), v_session.login_at), status = 'Logged Out',
      logout_source = 'user'
  where session_id = v_session.session_id;
  return jsonb_build_object('alreadyClosed', false, 'sessionId', v_session.session_id);
end;
$$;
revoke all on function public.portal_employee_end_session(uuid,uuid) from public, anon, authenticated;
grant execute on function public.portal_employee_end_session(uuid,uuid) to service_role;

create function public.portal_attendance_settings()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not public.is_admin() then raise exception 'Co-CEO access required' using errcode = '42501'; end if;
  select to_jsonb(s) into v_result from public.company_settings s where id = true;
  return v_result;
end;
$$;
revoke all on function public.portal_attendance_settings() from public, anon, authenticated;
grant execute on function public.portal_attendance_settings() to authenticated;

create function public.portal_attendance_update_settings(
  p_timezone text, p_workday_start time, p_late_after_minutes integer,
  p_workdays integer[], p_expected_daily_minutes integer, p_max_session_hours integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_before jsonb; v_after jsonb; v_actor public.employee_profiles%rowtype;
begin
  if not public.is_admin() then raise exception 'Co-CEO access required' using errcode = '42501'; end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name = p_timezone)
    or p_workday_start is null or p_late_after_minutes not between 0 and 180
    or p_workdays is null or cardinality(p_workdays) not between 1 and 7
    or exists(select 1 from unnest(p_workdays) d where d not between 1 and 7)
    or (select count(distinct d) from unnest(p_workdays) d) <> cardinality(p_workdays)
    or p_expected_daily_minutes not between 60 and 1440
    or p_max_session_hours not between 4 and 72 then
    raise exception 'Invalid attendance schedule' using errcode = '22023';
  end if;
  select * into v_actor from public.employee_profiles where id = auth.uid();
  select to_jsonb(s) into v_before from public.company_settings s where id = true for update;
  update public.company_settings
  set timezone = p_timezone, workday_start = p_workday_start,
      late_after_minutes = p_late_after_minutes, workdays = p_workdays,
      expected_daily_minutes = p_expected_daily_minutes,
      max_session_hours = p_max_session_hours where id = true;
  select to_jsonb(s) into v_after from public.company_settings s where id = true;
  if v_before is distinct from v_after then
    insert into public.portal_admin_audit_log
      (admin_id, admin_name, target_name, action, before_state, after_state)
    values (v_actor.id, v_actor.full_name, 'Attendance schedule', 'attendance_settings_changed', v_before, v_after);
  end if;
  return v_after;
end;
$$;
revoke all on function public.portal_attendance_update_settings(text,time,integer,integer[],integer,integer) from public, anon, authenticated;
grant execute on function public.portal_attendance_update_settings(text,time,integer,integer[],integer,integer) to authenticated;

create function public.portal_attendance_daily(p_from date, p_to date, p_employee uuid default null)
returns table (
  user_id uuid, employee_id text, full_name text, scheme text, role text,
  account_active boolean, attendance_date date, scheduled boolean, active_on_day boolean,
  first_sign_in timestamptz, last_sign_out timestamptz, worked_minutes bigint,
  session_count integer, open_count integer, review_count integer,
  is_late boolean, attendance_status text
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Co-CEO access required' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 45 then
    raise exception 'Choose a range of at most 46 days' using errcode = '22023';
  end if;
  return query
  with settings as (
    select timezone, workday_start, late_after_minutes, workdays
    from public.company_settings where id = true
  ), days as (
    select gs::date as day from generate_series(p_from, p_to, interval '1 day') gs
  ), grid as (
    select p.id, p.employee_id, p.full_name, p.scheme, p.role, p.is_active,
      d.day, s.timezone, s.workday_start, s.late_after_minutes,
      extract(isodow from d.day)::integer = any(s.workdays) as scheduled,
      exists (
        select 1 from public.employee_active_periods ap
        where ap.employee_id = p.id
          and ap.started_at <= (d.day::timestamp + s.workday_start) at time zone s.timezone
          and (ap.ended_at is null or ap.ended_at > (d.day::timestamp + s.workday_start) at time zone s.timezone)
      ) as active_on_day
    from public.employee_profiles p cross join days d cross join settings s
    where p_employee is null or p.id = p_employee
  )
  select g.id, g.employee_id, g.full_name, g.scheme, g.role, g.is_active,
    g.day, g.scheduled, g.active_on_day, agg.first_login, agg.last_logout,
    coalesce(agg.worked_minutes,0)::bigint, coalesce(agg.session_count,0)::integer,
    coalesce(agg.open_count,0)::integer, coalesce(agg.review_count,0)::integer,
    (agg.first_login is not null and g.scheduled and
      (agg.first_login at time zone g.timezone)::time >
        g.workday_start + make_interval(mins => g.late_after_minutes)) as is_late,
    case
      when coalesce(agg.open_count,0) > 0 then 'Signed In'
      when coalesce(agg.review_count,0) > 0 then 'Incomplete'
      when coalesce(agg.session_count,0) > 0 then 'Signed Out'
      when not g.scheduled or not g.active_on_day then 'Not Scheduled'
      when g.day < (now() at time zone g.timezone)::date then 'Absent'
      when g.day = (now() at time zone g.timezone)::date and
        (now() at time zone g.timezone)::time >
          g.workday_start + make_interval(mins => g.late_after_minutes) then 'Absent'
      else 'Awaiting'
    end
  from grid g
  left join lateral (
    select min(a.login_at) first_login, max(a.logout_at) last_logout,
      sum(case when a.logout_at is not null then
        greatest(0,floor(extract(epoch from a.logout_at-a.login_at)/60)) else 0 end) worked_minutes,
      count(*) session_count,
      count(*) filter (where a.status = 'Logged In') open_count,
      count(*) filter (where a.status = 'Needs Review') review_count
    from public.employee_activity_sessions a
    where a.employee_id = g.id
      and a.login_at >= (g.day::timestamp at time zone g.timezone)
      and a.login_at < ((g.day + 1)::timestamp at time zone g.timezone)
  ) agg on true
  order by g.day desc, g.full_name;
end;
$$;
revoke all on function public.portal_attendance_daily(date,date,uuid) from public, anon, authenticated;
grant execute on function public.portal_attendance_daily(date,date,uuid) to authenticated;

create function public.portal_attendance_monthly(p_month date)
returns table (
  user_id uuid, employee_id text, full_name text, scheme text, role text,
  account_active boolean, present_days bigint, absent_days bigint, late_days bigint,
  worked_minutes bigint, incomplete_days bigint, scheduled_days bigint,
  attendance_percent numeric, average_arrival_minutes numeric
) language plpgsql stable security definer set search_path = '' as $$
declare v_first date; v_last date; v_timezone text;
begin
  if not public.is_admin() then raise exception 'Co-CEO access required' using errcode = '42501'; end if;
  if p_month is null then raise exception 'Month is required' using errcode = '22023'; end if;
  v_first := date_trunc('month', p_month)::date;
  v_last := (v_first + interval '1 month' - interval '1 day')::date;
  select timezone into v_timezone from public.company_settings where id = true;
  return query
  select d.user_id, max(d.employee_id), max(d.full_name), max(d.scheme), max(d.role),
    bool_or(d.account_active),
    count(*) filter (where d.session_count > 0),
    count(*) filter (where d.attendance_status = 'Absent'),
    count(*) filter (where d.is_late),
    coalesce(sum(d.worked_minutes),0)::bigint,
    count(*) filter (where d.review_count > 0 or
      (d.open_count > 0 and d.attendance_date < (now() at time zone v_timezone)::date)),
    count(*) filter (where d.scheduled and d.active_on_day and
      d.attendance_status <> 'Awaiting'),
    case when count(*) filter (where d.scheduled and d.active_on_day and
      d.attendance_status <> 'Awaiting') = 0 then null
      else round(100.0 * count(*) filter (where d.session_count > 0 and d.scheduled) /
        count(*) filter (where d.scheduled and d.active_on_day and
          d.attendance_status <> 'Awaiting'),1) end,
    round(avg(extract(hour from d.first_sign_in at time zone v_timezone)*60 +
      extract(minute from d.first_sign_in at time zone v_timezone)),0)
  from public.portal_attendance_daily(v_first,v_last,null) d
  group by d.user_id
  order by max(d.full_name);
end;
$$;
revoke all on function public.portal_attendance_monthly(date) from public, anon, authenticated;
grant execute on function public.portal_attendance_monthly(date) to authenticated;

create function public.portal_attendance_sessions(
  p_from date, p_to date, p_employee uuid default null,
  p_limit integer default 100, p_offset integer default 0)
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
    or p_limit not between 1 and 200 or p_offset not between 0 and 100000 then
    raise exception 'Invalid history range or page' using errcode = '22023';
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
  order by a.login_at desc limit p_limit offset p_offset;
end;
$$;
revoke all on function public.portal_attendance_sessions(date,date,uuid,integer,integer) from public, anon, authenticated;
grant execute on function public.portal_attendance_sessions(date,date,uuid,integer,integer) to authenticated;

create function public.portal_attendance_issues(p_limit integer default 200)
returns table (
  session_id uuid, user_id uuid, employee_id text, full_name text,
  login_at timestamptz, logout_at timestamptz, status text, issue text,
  open_count bigint
) language plpgsql stable security definer set search_path = '' as $$
declare v_hours integer;
begin
  if not public.is_admin() then raise exception 'Co-CEO access required' using errcode = '42501'; end if;
  if p_limit not between 1 and 500 then raise exception 'Invalid limit' using errcode='22023'; end if;
  select max_session_hours into v_hours from public.company_settings where id=true;
  return query
  with opens as (
    select employee_id, count(*) n from public.employee_activity_sessions
    where status='Logged In' group by employee_id
  )
  select a.session_id,a.employee_id,p.employee_id,p.full_name,
    a.login_at,a.logout_at,a.status,
    case when a.status='Needs Review' then 'Missing sign-out'
      when coalesce(o.n,0)>1 then 'Multiple open sessions'
      when a.login_at>now() then 'Future sign-in'
      when a.login_at<now()-make_interval(hours=>v_hours) then 'Long open session'
      when a.logout_at<a.login_at then 'Negative duration'
      else 'Manual review' end,
    coalesce(o.n,0)
  from public.employee_activity_sessions a
  join public.employee_profiles p on p.id=a.employee_id
  left join opens o on o.employee_id=a.employee_id
  where a.status in ('Logged In','Needs Review')
    and (a.status='Needs Review' or coalesce(o.n,0)>1
      or a.login_at>now() or a.login_at<now()-make_interval(hours=>v_hours))
    or a.logout_at<a.login_at
  order by a.login_at desc limit p_limit;
end;
$$;
revoke all on function public.portal_attendance_issues(integer) from public, anon, authenticated;
grant execute on function public.portal_attendance_issues(integer) to authenticated;

create function public.portal_attendance_audit(p_limit integer default 100,p_offset integer default 0)
returns table (
  id uuid, admin_id uuid, admin_name text, target_user_id uuid, target_name text,
  action text, before_state jsonb, after_state jsonb, reason text, created_at timestamptz
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Co-CEO access required' using errcode='42501'; end if;
  if p_limit not between 1 and 200 or p_offset not between 0 and 100000 then
    raise exception 'Invalid page' using errcode='22023';
  end if;
  return query select a.id,a.admin_id,a.admin_name,a.target_user_id,a.target_name,
    a.action,a.before_state,a.after_state,a.reason,a.created_at
  from public.portal_admin_audit_log a
  order by a.created_at desc limit p_limit offset p_offset;
end;
$$;
revoke all on function public.portal_attendance_audit(integer,integer) from public, anon, authenticated;
grant execute on function public.portal_attendance_audit(integer,integer) to authenticated;

create function public.portal_attendance_correct_session(
  p_session_id uuid,p_login_at timestamptz,p_logout_at timestamptz,p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_before public.employee_activity_sessions%rowtype;
  v_actor public.employee_profiles%rowtype; v_target text; v_status text;
begin
  if not public.is_admin() then raise exception 'Co-CEO access required' using errcode='42501'; end if;
  if p_login_at is null or p_login_at > now()+interval '5 minutes'
    or (p_logout_at is not null and (p_logout_at<p_login_at or p_logout_at>now()+interval '5 minutes'))
    or length(btrim(coalesce(p_reason,''))) < 5 then
    raise exception 'Valid times and a reason of at least five characters are required' using errcode='22023';
  end if;
  select * into v_before from public.employee_activity_sessions where session_id=p_session_id for update;
  if not found then raise exception 'Session not found' using errcode='P0002'; end if;
  select * into v_actor from public.employee_profiles where id=auth.uid();
  select full_name into v_target from public.employee_profiles where id=v_before.employee_id;
  v_status := case when p_logout_at is not null then 'Logged Out'
    when v_before.status='Needs Review' then 'Needs Review' else 'Logged In' end;
  if v_status='Logged In' and exists (
    select 1 from public.employee_activity_sessions
    where employee_id=v_before.employee_id and status='Logged In' and session_id<>p_session_id
  ) then raise exception 'Another open session exists for this employee' using errcode='23505'; end if;
  if (v_before.login_at,v_before.logout_at,v_before.status)
    is not distinct from (p_login_at,p_logout_at,v_status) then
    raise exception 'No attendance change was supplied' using errcode='22023';
  end if;
  update public.employee_activity_sessions
  set login_at=p_login_at,logout_at=p_logout_at,status=v_status,
    corrected_by=v_actor.id,corrected_at=now(),correction_reason=btrim(p_reason),
    logout_source=case when p_logout_at is not null then 'admin' else null end,
    logout_actor_id=case when p_logout_at is not null then v_actor.id else null end,
    logout_reason=case when p_logout_at is not null then btrim(p_reason) else null end
  where session_id=p_session_id;
  insert into public.portal_admin_audit_log
    (admin_id,admin_name,target_user_id,target_name,action,before_state,after_state,reason)
  values (v_actor.id,v_actor.full_name,v_before.employee_id,v_target,'attendance_corrected',
    jsonb_build_object('session_id',p_session_id,'login_at',v_before.login_at,
      'logout_at',v_before.logout_at,'status',v_before.status),
    jsonb_build_object('session_id',p_session_id,'login_at',p_login_at,
      'logout_at',p_logout_at,'status',v_status),btrim(p_reason));
  return jsonb_build_object('session_id',p_session_id,'status',v_status);
end;
$$;
revoke all on function public.portal_attendance_correct_session(uuid,timestamptz,timestamptz,text) from public, anon, authenticated;
grant execute on function public.portal_attendance_correct_session(uuid,timestamptz,timestamptz,text) to authenticated;

create function public.portal_attendance_add_session(
  p_employee_id uuid,p_login_at timestamptz,p_logout_at timestamptz,p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor public.employee_profiles%rowtype; v_target public.employee_profiles%rowtype;
  v_id uuid := gen_random_uuid(); v_status text;
begin
  if not public.is_admin() then raise exception 'Co-CEO access required' using errcode='42501'; end if;
  if p_login_at is null or p_login_at > now()+interval '5 minutes'
    or (p_logout_at is not null and (p_logout_at<p_login_at or p_logout_at>now()+interval '5 minutes'))
    or length(btrim(coalesce(p_reason,''))) < 5 then
    raise exception 'Valid times and a reason of at least five characters are required' using errcode='22023';
  end if;
  select * into v_target from public.employee_profiles where id=p_employee_id for update;
  if not found then raise exception 'Employee not found' using errcode='P0002'; end if;
  select * into v_actor from public.employee_profiles where id=auth.uid();
  if p_logout_at is null and exists (
    select 1 from public.employee_activity_sessions where employee_id=p_employee_id and status='Logged In'
  ) then raise exception 'Resolve existing open sessions first' using errcode='23505'; end if;
  v_status:=case when p_logout_at is not null then 'Logged Out'
    when (p_login_at at time zone (select timezone from public.company_settings where id=true))::date
      < (now() at time zone (select timezone from public.company_settings where id=true))::date
    then 'Needs Review' else 'Logged In' end;
  insert into public.employee_activity_sessions
    (session_id,employee_id,login_at,logout_at,status,
      login_source,logout_source,login_actor_id,logout_actor_id,login_reason,logout_reason,
      corrected_by,corrected_at,correction_reason)
  values (v_id,p_employee_id,p_login_at,p_logout_at,v_status,
    'admin',case when p_logout_at is not null then 'admin' else null end,
    v_actor.id,case when p_logout_at is not null then v_actor.id else null end,
    btrim(p_reason),case when p_logout_at is not null then btrim(p_reason) else null end,
    v_actor.id,now(),btrim(p_reason));
  insert into public.portal_admin_audit_log
    (admin_id,admin_name,target_user_id,target_name,action,after_state,reason)
  values (v_actor.id,v_actor.full_name,p_employee_id,v_target.full_name,'attendance_manually_added',
    jsonb_build_object('session_id',v_id,'login_at',p_login_at,'logout_at',p_logout_at,
      'status',v_status),btrim(p_reason));
  return jsonb_build_object('session_id',v_id,'status',v_status);
end;
$$;
revoke all on function public.portal_attendance_add_session(uuid,timestamptz,timestamptz,text) from public, anon, authenticated;
grant execute on function public.portal_attendance_add_session(uuid,timestamptz,timestamptz,text) to authenticated;
